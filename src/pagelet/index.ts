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
    renderReviewBody,
    resolveReviewNotePath,
    resolveReviewsFolderPath,
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
    PAGELET_SEGMENT_TARGET_CHARS,
    buildPageletScopeReviewBundle,
    type BuildPageletScopeReviewBundleOptions,
    type PageletReviewRange,
    type PageletScopeReviewBundle,
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
    PAGELET_ELIGIBLE_VIEW_TYPE,
    PAGELET_FOCUS_LATEST_COMMAND_ID,
    PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY,
    PAGELET_FOCUSABLE_SELECTORS,
    PAGELET_SUGGESTION_CARD_CLASS,
    findFirstFocusableInCard,
    findFirstSuggestionCard,
    findFocusTargetForCommand,
    getActiveMarkdownView,
    isPageletEligibleView,
    registerPageletFocusCommand,
    type PageletCommandDefinition,
    type PageletCommandHost,
    type PageletFocusableElement,
    type PageletHotkey,
    type PageletQueryRoot,
    type PageletObsidianViewProbe,
    type PageletWorkspaceLike,
    type RegisterPageletFocusCommandOptions,
} from "./compat";

export { PetView, PetStateMachine, updatePetSvgState } from "./pet";
export type { PetState, PetTaskKind, PetCorner, PetEvent, PetCallbacks, PetRenderer, PetRendererOptions, PetStateListener } from "./pet";

export { BubbleView, buildIntentionallyQuietContent } from "./bubble";
export type { BubbleState, BubbleContentType, BubbleFinding, BubbleContent, BubbleAction, BubbleCallbacks, BubbleQuickAccessCallbacks, BubbleStateCallbacks, BubbleViewOptions, BubbleExplanationState, DeliveryCandidate, DeliveryCandidateKind, DeliveryCandidateRoute, DeliveryCandidateSourceRef, DeliveryCandidateStaleStatus, InlineContextHint } from "./bubble";


export {
    ScopeResolver,
} from "./scope/index";
export type {
    ScopeCandidate,
    ExclusionReason,
    ScopeResult,
    ScopeConfig,
} from "./scope/index";

export { ProactiveHints } from "./hints";
export type { ProactiveHintsConfig } from "./hints";

export type { GeneratedReviewNote, WriteResult } from "./output";

export {
    registerPageletCommands,
    PAGELET_OPEN_PANEL_COMMAND_ID,
    PAGELET_DISCOVER_COMMAND_ID,
    PAGELET_MAINTENANCE_REVIEW_COMMAND_ID,
    PAGELET_GRAPH_DISCOVERY_COMMAND_ID,
    PAGELET_TOGGLE_HINTS_COMMAND_ID,
    PAGELET_MOVE_PET_COMMAND_ID,
    PAGELET_TOGGLE_PET_COMMAND_ID,
} from "./commands";
export type { PageletCommandCallbacks } from "./commands";

export { PageletOrchestrator } from "./orchestrator";
export type { PageletHost } from "./PageletHost";

export {
    buildDiscoveryPrompt,
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

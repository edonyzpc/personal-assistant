/* Copyright 2023 edonyzpc */

/**
 * Pagelet — SuggestionCard module barrel.
 *
 * As with the mascot module, internal DOM-host plumbing is exposed
 * here for the test spec but deliberately NOT re-exported from the
 * top-level pagelet barrel.
 */

export {
    SUGGESTION_BADGE_KINDS,
    type SuggestionBadgeKind,
    type SuggestionCardProps,
    type SuggestionCardRenderer,
    type SuggestionCardRendererOptions,
    type SuggestionCardTranslator,
    type PageletCostEntry,
    type PageletReviewDiagnostics,
    type PageletSuggestion,
    type PageletSuggestionKind,
} from "./types";

export {
    SUGGESTION_KIND_I18N_KEY,
    buildSuggestionCardMarkup,
    type BuildSuggestionCardMarkupOptions,
    type SuggestionBadgeMarkup,
    type SuggestionCardMarkup,
    type SuggestionCostMarkup,
    type SuggestionRelatedItemMarkup,
} from "./markup";

export {
    createSuggestionCardRenderer,
    createSuggestionCardRendererWithHost,
    type SuggestionCardDomHost,
    type SuggestionCardDomNode,
} from "./dom-renderer";

/* Copyright 2023 edonyzpc */

/**
 * Pagelet — UI module top-level barrel.
 *
 * Re-exports the SuggestionCard public surface. Internal
 * DOM-host abstractions are deliberately NOT re-exported here; callers
 * that need to test against a stub host should import from the
 * specific sub-module barrel (`./suggestion-card`).
 */

export {
    SUGGESTION_BADGE_KINDS,
    SUGGESTION_KIND_I18N_KEY,
    buildSuggestionCardMarkup,
    createSuggestionCardRenderer,
    type BuildSuggestionCardMarkupOptions,
    type SuggestionBadgeKind,
    type SuggestionBadgeMarkup,
    type SuggestionCardMarkup,
    type SuggestionCardProps,
    type SuggestionCardRenderer,
    type SuggestionCardRendererOptions,
    type SuggestionCardTranslator,
    type SuggestionCostMarkup,
    type SuggestionRelatedItemMarkup,
} from "./suggestion-card";

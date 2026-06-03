/* Copyright 2023 edonyzpc */

/**
 * Pagelet — UI module top-level barrel.
 *
 * Re-exports the Mascot and SuggestionCard public surfaces. Internal
 * DOM-host abstractions are deliberately NOT re-exported here; callers
 * that need to test against a stub host should import from the
 * specific sub-module barrel (`./mascot` or `./suggestion-card`).
 */

export {
    MASCOT_STATES,
    MASCOT_STATE_I18N_KEY,
    MASCOT_STATE_STROKE_VAR,
    MASCOT_SVG_VIEWBOX,
    buildMascotMarkup,
    createMascotRenderer,
    type BuildMascotMarkupOptions,
    type MascotMarkup,
    type MascotRenderer,
    type MascotRendererOptions,
    type MascotSetStateOptions,
    type MascotState,
    type MascotSvgCircle,
    type MascotSvgPath,
    type MascotSvgShapes,
    type MascotTranslator,
} from "./mascot";

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

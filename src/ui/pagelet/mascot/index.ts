/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Mascot module barrel.
 *
 * Exports the surface that downstream code (Track C C1 wiring, B5 a11y
 * extensions, and the SuggestionCard module) is expected to consume.
 *
 * Internal types (`MascotDomNode`, `MascotDomHost`, `RealDomNode`) are
 * deliberately NOT re-exported — they are testing seams, not part of
 * the public contract.
 */

export {
    MASCOT_STATE_ANNOUNCE_I18N_KEY,
    MASCOT_STATE_LIVE_LEVEL,
    MASCOT_STATES,
    type MascotLiveAnnouncement,
    type MascotLiveLevel,
    type MascotRenderer,
    type MascotRendererOptions,
    type MascotSetStateOptions,
    type MascotState,
    type MascotTranslator,
} from "./types";

export {
    MASCOT_STATE_I18N_KEY,
    MASCOT_STATE_STROKE_VAR,
    MASCOT_SVG_VIEWBOX,
    buildMascotMarkup,
    type BuildMascotMarkupOptions,
    type MascotMarkup,
    type MascotSvgCircle,
    type MascotSvgPath,
    type MascotSvgShapes,
} from "./markup";

export {
    createMascotRenderer,
    // Test-only: exposed here for the spec to wire in a stub host
    // without reaching into the dom-renderer module path. Not
    // re-exported from `pagelet/index.ts`.
    createMascotRendererWithHost,
    type MascotDomHost,
    type MascotDomNode,
} from "./dom-renderer";

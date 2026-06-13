/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Mascot UI types.
 *
 * Spec source: `docs/review-assistant-sdd.md` §10.1 + `docs/pagelet-visual-spec.html`.
 *
 * What this file declares (and ONLY this):
 *   - The 4-state enum every Mascot consumer reasons about.
 *   - The renderer's external contract (`MascotRenderer`) so callers
 *     can swap implementations (real DOM renderer in production, a
 *     recording stub in tests) without depending on the concrete class.
 *   - Options bag types for `createMascotRenderer` / `setState`.
 *
 * What this file does NOT declare:
 *   - Markup composition (state class names, SVG path data) → markup.ts.
 *   - DOM mounting / re-render strategy → dom-renderer.ts.
 *   - i18n keys themselves → src/locales/pagelet/en.json (B3 owns the wording).
 *
 * The split is deliberate: B5 a11y work will need to extend the
 * renderer with `aria-live` / `prefers-reduced-motion` hooks; isolating
 * the public contract here means B5 can do that without rewriting
 * production callers.
 */

import type { PageletLocale } from "../../../locales/pagelet";

/**
 * Mascot state machine values (SDD §10.1). The 4 states map 1:1 to the
 * 4 SVG renderings in the visual spec (`pagelet-visual-spec.html` §①).
 *
 * @deprecated Use PetState from src/pagelet/pet/types instead. Will be removed before 2.3.0 stable.
 */
export type MascotState = "idle" | "thinking" | "done" | "error";

export const MASCOT_STATES: readonly MascotState[] = [
    "idle",
    "thinking",
    "done",
    "error",
] as const;

/**
 * Options the public `setMascotState(state, options?)` API accepts.
 * Per the B2 task brief: support an abort signal and an optional
 * message override. Anything more elaborate (icon swap, custom
 * animation) belongs in a future iteration, not part of the current baseline.
 */
export interface MascotSetStateOptions {
    /**
     * Override the default i18n message for this state. Use when the
     * caller already has a more specific status string (e.g. "Reviewing
     * notes/foo.md…"). When omitted, the renderer looks up the canonical
     * `pagelet.mascot.<state>` key.
     */
    message?: string;
    /**
     * Abort signal. If aborted by the time the transition is applied,
     * the renderer no-ops. This lets long-running callers cancel pending
     * state updates without races.
     */
    signal?: AbortSignal;
}

/**
 * Construction-time options. `locale` defaults to "en" so tests and
 * headless callers don't depend on an Obsidian shell. The translator
 * seam exists so tests can assert i18n key lookups without pulling in
 * the JSON dictionary.
 */
export interface MascotRendererOptions {
    /**
     * UI locale for default message lookups. Per D014, this is the
     * Obsidian UI language (NOT the detected note language).
     */
    locale?: PageletLocale;
    /**
     * Initial state. Defaults to "idle" so the mascot is non-obtrusive
     * until the host explicitly starts a review.
     */
    initialState?: MascotState;
    /**
     * Pluggable translator. Defaults to `pageletT` from
     * src/locales/pagelet. Tests pass a stub to assert which keys are
     * looked up without coupling to the dictionary contents.
     */
    translator?: MascotTranslator;
    /**
     * Optional aria-label for the root. Defaults to the
     * `pagelet.a11y.mascotLabel` entry. B5 may override here to
     * thread richer accessibility copy through.
     */
    ariaLabel?: string;
    /**
     * Optional `data-plugin` attribute value on the root, matching the
     * visual spec convention (`data-plugin="pa-pagelet"`). Exposed so
     * tests can override; production uses the spec default.
     */
    dataPlugin?: string;
    /**
     * B5 / D007.4 — reduced-motion seam.
     *
     * Probe invoked at construction time AND on every `setState`. When
     * it returns `true`, the renderer strips SVG animation classes
     * (no blink / float / pulse) AND adds a `--reduce-motion` modifier
     * to the root so a CSS theme can suppress any leftover keyframes.
     *
     * Why a factory (not a boolean):
     *   - `prefers-reduced-motion` is a live media query — the user can
     *     toggle the OS setting mid-session. Re-evaluating on every
     *     setState catches the change without observers / listeners.
     *   - Tests inject a deterministic stub instead of mocking
     *     `window.matchMedia`. The default uses `window.matchMedia` when
     *     available, otherwise returns `false`.
     */
    prefersReducedMotion?: () => boolean;
    /**
     * B5 — accessible "announcement" seam.
     *
     * Receives the resolved announcement string + `aria-live` level for
     * the current state. Default behavior writes into an internal
     * `aria-live` region attached to the mascot's root. Tests stub it
     * to assert announcement timing without inspecting the DOM tree.
     *
     * Only fires when the state transitions to one of the announcing
     * states (`done` → polite, `error` → assertive). `idle` /
     * `thinking` clear the region (empty string + `"off"`).
     */
    announceLiveRegion?: (announcement: MascotLiveAnnouncement) => void;
}

/**
 * Live-region announcement payload. Resolved once per state transition
 * (or on initial mount) and either pushed into the default DOM live
 * region or forwarded to a caller-supplied seam.
 *
 * - `message`: short, already-translated; empty string means "clear the
 *   region" so subsequent same-state re-entry can re-announce.
 * - `level`: maps to the `aria-live` attribute. `off` means do not
 *   announce; `polite` for `done`; `assertive` for `error`.
 */
export interface MascotLiveAnnouncement {
    state: MascotState;
    message: string;
    level: MascotLiveLevel;
}

/** Mascot aria-live level. */
export type MascotLiveLevel = "off" | "polite" | "assertive";

/**
 * State → aria-live level mapping. Frozen so callers can rely on
 * referential stability when comparing.
 *
 * - `done` → polite: a non-interrupting confirmation suffices.
 * - `error` → assertive: failures should override pending speech.
 * - `idle` / `thinking` → off: no announcement (the visual change is
 *   enough; assertive thinking would be noise).
 */
export const MASCOT_STATE_LIVE_LEVEL: Readonly<Record<MascotState, MascotLiveLevel>> = Object.freeze({
    idle: "off",
    thinking: "off",
    done: "polite",
    error: "assertive",
});

/**
 * State → i18n key for the announcement message. `idle` / `thinking`
 * are intentionally absent — we never read these (level === "off").
 */
export const MASCOT_STATE_ANNOUNCE_I18N_KEY: Readonly<Record<MascotState, string | null>> = Object.freeze({
    idle: null,
    thinking: null,
    done: "pagelet.a11y.announce.done",
    error: "pagelet.a11y.announce.error",
});

/**
 * Translator function shape — narrowed to the single (key, fallback)
 * lookup pattern the mascot needs. We do NOT use `pageletT`'s full
 * signature here because mascot copy never interpolates params, and
 * narrowing the seam means tests don't have to mock a 4-arg function.
 */
export type MascotTranslator = (key: string, fallback?: string) => string;

/**
 * The public surface every Mascot consumer sees. Implementations:
 *   - `createMascotRenderer(parentEl, opts)` → real DOM renderer
 *   - `createRecordingMascotRenderer(opts)` (test util) → no-DOM stub
 *
 * Keeping `state` readable lets callers query the current state
 * without owning their own mirror; `destroy()` releases DOM listeners
 * and detaches the root from the parent.
 */
export interface MascotRenderer {
    /** Current applied state. Reflects the latest `setState` call. */
    readonly state: MascotState;
    /** Apply a new state. No-op when state == current state or signal aborted. */
    setState(state: MascotState, options?: MascotSetStateOptions): void;
    /**
     * Detach the rendered root from the parent and release any
     * listeners. Idempotent; safe to call from `Component.onunload`.
     */
    destroy(): void;
}

/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Cmd+/ focus jump-in (Track B · B5).
 *
 * Spec source:
 *  - `docs/review-assistant-sdd.md` §6.2 + §9.1 (focus management)
 *  - i18n key `pagelet.a11y.focusLatestCommand` (B3)
 *
 * Goal: a global Obsidian command — bound to `Mod+/` by default — that
 * moves keyboard focus into the FIRST interactive element of the
 * currently-mounted Pagelet SuggestionCard. If multiple cards are
 * mounted (e.g. after a deeper review), focus the first card.
 *
 * Why "first card" not "latest":
 *  - The SDD §9.1 command name is "Pagelet: focus latest suggestion",
 *    but the suggestion panel renders cards in DOM order with the
 *    newest at the TOP (typical review queue). "First in DOM" ==
 *    "latest produced" — the two read the same.
 *  - If the panel is ever reordered, we can keep the command intent
 *    by overriding `findFirstCard` in tests / config.
 *
 * Why not directly call `view.containerEl.focus()`:
 *  - That would dump focus onto the panel itself, not into a card.
 *  - Screen readers would announce "Pagelet suggestions, region" and
 *    nothing more. Landing inside a button (Accept / Dismiss / source
 *    chip) immediately exposes the actionable content.
 *
 * Why we accept a `getSearchRoot` seam:
 *  - Tests run without jsdom and need to pass a recorded DOM tree.
 *  - Future Track C wiring may want to scope to a particular view's
 *    container rather than the whole document — passing the right
 *    root keeps focus stable when multiple Obsidian windows are open.
 */

// ---------------------------------------------------------------------------
// Constants — stable IDs / hotkeys
// ---------------------------------------------------------------------------

/**
 * Obsidian command ID. All Pagelet commands use the `pa-pagelet:`
 * prefix to avoid collisions with
 * other PA commands / third-party plugins.
 */
export const PAGELET_FOCUS_LATEST_COMMAND_ID = "pa-pagelet:focus-latest-suggestion" as const;

/** Default hotkey: `Mod+/` (= Cmd+/ on macOS, Ctrl+/ everywhere else). */
export const PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY = Object.freeze({
    modifiers: Object.freeze(["Mod"] as const),
    key: "/" as const,
});

/** CSS class used to scope card lookups. Matches SuggestionCard's root. */
export const PAGELET_SUGGESTION_CARD_CLASS = "pa-pagelet-suggestion-card" as const;

// ---------------------------------------------------------------------------
// Element abstractions
// ---------------------------------------------------------------------------

/** Anything DOM-like that exposes querySelector + focus. */
export interface PageletFocusableElement {
    focus(options?: { preventScroll?: boolean }): void;
}

export interface PageletQueryRoot {
    querySelector(selectors: string): unknown;
    querySelectorAll(selectors: string): { length: number; item(i: number): unknown } | Iterable<unknown>;
}

// ---------------------------------------------------------------------------
// Pure focus logic — usable without Obsidian
// ---------------------------------------------------------------------------

/**
 * Selectors for "interactive" elements inside a SuggestionCard, in
 * priority order. We list them explicitly (rather than the broader
 * `[tabindex]:not([tabindex="-1"])`) so a future cosmetic refactor
 * that adds non-button affordances doesn't accidentally become the
 * focus target.
 */
export const PAGELET_FOCUSABLE_SELECTORS = Object.freeze([
    "button.pa-pagelet-suggestion-card__source-chip--interactive",
    "button.pa-pagelet-suggestion-card__btn--accept",
    "button.pa-pagelet-suggestion-card__btn--dismiss",
    "button",
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
] as const);

/**
 * Find the first SuggestionCard in DOM order under `root`.
 *
 * Returns `null` when there are no Pagelet cards mounted — caller
 * MUST short-circuit and NOT call `.focus()` on null (a noisy
 * runtime error would be worse than the command being a no-op).
 */
export function findFirstSuggestionCard(root: PageletQueryRoot | null): unknown {
    if (!root) return null;
    return root.querySelector(`.${PAGELET_SUGGESTION_CARD_CLASS}`);
}

/**
 * Within a given SuggestionCard element, find the first focus target
 * per `PAGELET_FOCUSABLE_SELECTORS` priority order.
 */
export function findFirstFocusableInCard(card: unknown): PageletFocusableElement | null {
    if (!card || typeof (card as PageletQueryRoot).querySelector !== "function") return null;
    const root = card as PageletQueryRoot;
    for (const selector of PAGELET_FOCUSABLE_SELECTORS) {
        const hit = root.querySelector(selector);
        if (hit && isFocusable(hit)) return hit as PageletFocusableElement;
    }
    return null;
}

/**
 * Convenience: scan from a search root straight to the focusable element.
 * Returns `null` when no eligible target exists.
 */
export function findFocusTargetForCommand(root: PageletQueryRoot | null): PageletFocusableElement | null {
    const card = findFirstSuggestionCard(root);
    if (!card) return null;
    return findFirstFocusableInCard(card);
}

function isFocusable(node: unknown): boolean {
    return Boolean(node) && typeof (node as { focus?: unknown }).focus === "function";
}

// ---------------------------------------------------------------------------
// Command registration helper (Obsidian-adjacent)
// ---------------------------------------------------------------------------

/**
 * Hotkey shape Obsidian's `addCommand({ hotkeys: [...] })` accepts.
 * Defined locally so this module doesn't import `obsidian` (keeps it
 * jest-runnable without the heavy mock).
 */
export interface PageletHotkey {
    modifiers: readonly ("Mod" | "Ctrl" | "Meta" | "Shift" | "Alt")[];
    key: string;
}

/** Command definition passed to Obsidian's `addCommand`. */
export interface PageletCommandDefinition {
    id: string;
    name: string;
    hotkeys?: readonly PageletHotkey[];
    callback: () => void;
}

/** Subset of `Plugin` we need to register the command. */
export interface PageletCommandHost {
    addCommand(definition: PageletCommandDefinition): unknown;
}

export interface RegisterPageletFocusCommandOptions {
    /**
     * Localized display name (e.g. `pageletT("pagelet.a11y.focusLatestCommand")`).
     * Falls back to a hard-coded EN string when omitted so misconfigured
     * hosts still ship a usable command.
     */
    name?: string;
    /**
     * Override the default hotkey (e.g. when the user has remapped
     * the chord). Pass `null` to register WITHOUT a default hotkey
     * (lets users pick one in Settings → Hotkeys).
     */
    hotkeys?: readonly PageletHotkey[] | null;
    /**
     * Locate the search root for the suggestion-card scan. Defaults to
     * `document.body` when running in a real browser. Tests pass a stub.
     */
    getSearchRoot?: () => PageletQueryRoot | null;
    /**
     * Focus the resolved element. Defaults to `el.focus()`. Tests can
     * pass a spy to observe; production callers almost never override.
     */
    focusElement?: (el: PageletFocusableElement) => void;
}

const DEFAULT_NAME_EN = "Focus latest Pagelet suggestion";

/**
 * Register the Cmd+/ focus jump-in command on the supplied host.
 *
 * The command's callback is intentionally synchronous — focus changes
 * MUST land in the same task tick as the user's keypress to keep
 * screen readers from announcing stale content.
 */
export function registerPageletFocusCommand(
    host: PageletCommandHost,
    options: RegisterPageletFocusCommandOptions = {},
): void {
    const hotkeys = options.hotkeys === null
        ? undefined
        : (options.hotkeys ?? [PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY]);
    const getSearchRoot = options.getSearchRoot ?? defaultGetSearchRoot;
    const focusElement = options.focusElement ?? defaultFocus;

    host.addCommand({
        id: PAGELET_FOCUS_LATEST_COMMAND_ID,
        name: options.name ?? DEFAULT_NAME_EN,
        ...(hotkeys !== undefined ? { hotkeys } : {}),
        callback: () => {
            const target = findFocusTargetForCommand(getSearchRoot());
            if (target) focusElement(target);
        },
    });
}

function defaultGetSearchRoot(): PageletQueryRoot | null {
    if (typeof document === "undefined") return null;
    return document.body as unknown as PageletQueryRoot;
}

function defaultFocus(el: PageletFocusableElement): void {
    // `preventScroll: true` keeps the editor from jumping when focus
    // lands inside the panel — minor a11y comfort that mirrors the
    // SDD §9.1 "默认不抢焦点" intent (we DO take focus, but quietly).
    try {
        el.focus({ preventScroll: true });
    } catch {
        // Some focusable element types (older Safari quirk) reject the
        // options object. Fall back to the no-arg form rather than
        // failing the command.
        el.focus();
    }
}

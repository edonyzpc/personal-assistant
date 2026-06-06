/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — ribbon registration (Track B · B5 / R4).
 *
 * Spec source: `docs/review-assistant-sdd.md` §6.1 R4.
 *
 * Rule: Pagelet must register its ribbon icon with deterministic
 * visibility behavior.
 *
 * Obsidian-specific reality (the SDD calls this out):
 *  - Obsidian does NOT expose a stable "insert at index N" ribbon API.
 *  - All `Plugin.addRibbonIcon(...)` returns an element appended to
 *    the end of the ribbon at registration time.
 *  - Reordering is left to the user (or to the Commander plugin).
 *
 * So "deterministic visibility" means:
 *  1. Default placement: append (= AFTER the existing PA chat icon),
 *     because the chat icon registers earlier in `plugin.ts:163`. This
 *     gives a consistent visual order even without the user touching
 *     Commander.
 *  2. The `ribbonPosition` setting (B3) lets the user pick `"default"`
 *     or `"hidden"` (we hide the element entirely via `display: none`).
 *  3. We tag the element with a stable CSS class
 *     (`pa-pagelet-ribbon-icon`) and a `data-plugin="pa-pagelet"`
 *     attribute so Commander / user-CSS can still find it.
 *
 * Why this lives in compat:
 *  - It's a compatibility surface (3rd-party plugins observe ribbon
 *    icons by these conventions), not part of the review pipeline.
 *  - Track C will call `registerPageletRibbonIcon` from the plugin
 *    bootstrap. Pulling the registration into its own helper keeps
 *    plugin.ts edits to a single line when Track C wires it.
 */

import type { PageletRibbonPosition } from "../../settings/pagelet";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * The Obsidian icon ID Pagelet ribbon uses. `"scroll-text"` matches
 * SDD §6.1 R4 example (`this.addRibbonIcon("scroll-text", "Pagelet ...")`).
 * The chat ribbon uses `"PluginAST"` so the IDs are distinct.
 */
export const PAGELET_RIBBON_ICON_ID = "scroll-text" as const;

/**
 * CSS class stamped on the ribbon element so Commander-style tooling
 * (and user CSS) can pick it out without parsing tooltips.
 */
export const PAGELET_RIBBON_CSS_CLASS = "pa-pagelet-ribbon-icon" as const;

/**
 * `data-plugin` attribute Pagelet uses on its own DOM (see SDD §6.2 M1
 * "all selectors prefixed + data-plugin attribute"). Mirrored here on
 * the ribbon for the same reason.
 */
export const PAGELET_DATA_PLUGIN_VALUE = "pa-pagelet" as const;

/**
 * SDD §6.1 R4 tooltip. Kept in code (not i18n) because Obsidian's
 * ribbon tooltip is also surfaced to screen readers via the
 * `aria-label` Obsidian sets internally — we want the Beta marker
 * stable across locales for support bug reports. The caller may
 * override via `options.tooltip` to inject i18n copy.
 */
export const PAGELET_RIBBON_DEFAULT_TOOLTIP = "Pagelet (Beta)" as const;

// ---------------------------------------------------------------------------
// Host abstraction — narrow surface, NOT a full Plugin
// ---------------------------------------------------------------------------

/**
 * Minimal element surface the ribbon helper touches. Real Obsidian
 * `HTMLElement` satisfies it; the test stub also satisfies it. We do
 * NOT depend on the full HTMLElement type to keep this module testable
 * without jsdom.
 */
export interface PageletRibbonElement {
    addClass(cls: string): void;
    setAttribute(name: string, value: string): void;
    style: { display?: string; setProperty?(name: string, value: string): void };
}

/**
 * Subset of Obsidian's `Plugin.addRibbonIcon` we depend on. Real
 * `Plugin` satisfies this; the test stub also satisfies it.
 */
export interface PageletRibbonHost {
    addRibbonIcon(
        icon: string,
        tooltip: string,
        callback: (evt: MouseEvent) => unknown,
    ): PageletRibbonElement;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RegisterPageletRibbonOptions {
    /**
     * One of "default" | "hidden" — pulled from
     * `settings.pagelet.ribbonPosition`. Required so the caller has to
     * make an intentional choice.
     */
    position: PageletRibbonPosition;
    /** Click handler. Track C wires this to "open Pagelet panel". */
    onClick: (evt: MouseEvent) => unknown;
    /** Override the default tooltip (e.g. localized copy). */
    tooltip?: string;
    /** Override the default icon ID. Almost never needed. */
    iconId?: string;
}

export interface RegisterPageletRibbonResult {
    /** The Obsidian-returned ribbon element (already classed + attributed). */
    element: PageletRibbonElement;
    /** Effective position that was applied. */
    position: PageletRibbonPosition;
    /** Whether the element was hidden (position === "hidden"). */
    hidden: boolean;
}

/**
 * Register Pagelet's ribbon icon with deterministic conventions.
 *
 * Behavior matrix:
 *
 *   position      | DOM effect
 *   --------------|--------------------------------------------------------
 *   "default"     | append (relies on registration-order being stable)
 *   "hidden"      | append + style.display = "none"
 *
 * The element is ALWAYS tagged with the stable class + data-plugin
 * attribute so external tooling can find / reorder it later.
 *
 * Returning the element (rather than nothing) lets the caller chain
 * additional behavior (right-click context menu, etc.) without
 * re-registering. The PA chat ribbon does exactly this in
 * `plugin.ts:163-170`.
 */
export function registerPageletRibbonIcon(
    host: PageletRibbonHost,
    options: RegisterPageletRibbonOptions,
): RegisterPageletRibbonResult {
    const iconId = options.iconId ?? PAGELET_RIBBON_ICON_ID;
    const tooltip = options.tooltip ?? PAGELET_RIBBON_DEFAULT_TOOLTIP;
    const element = host.addRibbonIcon(iconId, tooltip, options.onClick);

    // Stable identification tags — applied for EVERY position, including
    // "hidden", so re-enabling the ribbon later doesn't need a re-mount.
    element.addClass(PAGELET_RIBBON_CSS_CLASS);
    element.setAttribute("data-plugin", PAGELET_DATA_PLUGIN_VALUE);

    let hidden = false;
    switch (options.position) {
        case "default":
            // Append-order is the natural deterministic position
            // (chat first, Pagelet second). Nothing else to do.
            break;
        case "hidden":
            element.style.display = "none";
            hidden = true;
            break;
        default:
            // Exhaustiveness guard. If a new position is ever added to
            // `PageletRibbonPosition`, TypeScript will flag this branch
            // at compile time.
            assertNever(options.position);
    }

    return { element, position: options.position, hidden };
}

function assertNever(value: never): never {
    throw new Error(`unhandled PageletRibbonPosition: ${String(value)}`);
}

/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — view-type gating (Track B · B5 / R1).
 *
 * Spec source: `docs/review-assistant-sdd.md` §6.1 R1.
 *
 * Rule: a Pagelet review may only fire when the currently active leaf
 * is a Markdown view. Canvas / Excalidraw / Kanban / PDF / DB Folder /
 * etc. all have to opt out — the cost-gate and the mascot would both
 * be nonsensical there, and Templater-style write hooks could
 * misinterpret a write into `.pagelet/` if a non-markdown leaf is the
 * active context.
 *
 * Source of truth: Obsidian's `WorkspaceLeaf.view.getViewType()` returns
 * the canonical view-type string. The literal `"markdown"` is the only
 * value we treat as Pagelet-eligible — see Obsidian's published
 * `MarkdownView.getViewType()` contract.
 *
 * Why a tiny module (not just a `=== "markdown"` check at the call site):
 *  - The check is invoked from three places (mount mascot, fire review,
 *    register debouncer). Having a named helper lets every caller agree
 *    on "what counts as a markdown view" instead of duplicating the
 *    string literal.
 *  - A future bump (e.g. adding `"markdown-readable"` or an inline
 *    edit modal) is a single-line change here.
 *  - Tests can exhaustively cover the gating decision without spinning
 *    up the heavyweight `MarkdownView` class.
 */

import type { MarkdownView, Workspace } from "obsidian";

/**
 * The single Obsidian view-type string Pagelet treats as eligible.
 * Exposed so tests / Track C wiring can reference the same literal.
 */
export const PAGELET_ELIGIBLE_VIEW_TYPE = "markdown" as const;

/**
 * Anything with a `getViewType(): string` accessor satisfies the check.
 * We narrow the parameter so callers don't have to import the heavy
 * `MarkdownView` type just to ask "should Pagelet fire here?".
 */
export interface PageletViewTypeProbe {
    getViewType(): string;
}

/**
 * Pure predicate. Returns `true` iff the supplied view is a real
 * Obsidian Markdown view.
 *
 * Defensive:
 *  - `null` / `undefined` → false (covers "no active leaf").
 *  - missing `getViewType` accessor → false (covers stripped mocks).
 *  - non-string return → false (covers third-party views that misbehave).
 */
export function isPageletEligibleView(view: PageletViewTypeProbe | null | undefined): boolean {
    if (view == null) return false;
    const probe = view as { getViewType?: unknown };
    if (typeof probe.getViewType !== "function") return false;
    let viewType: unknown;
    try {
        viewType = (view as PageletViewTypeProbe).getViewType();
    } catch {
        // A third-party view extension's getViewType() should never throw,
        // but our gating decision must stay safe even when it does.
        return false;
    }
    return viewType === PAGELET_ELIGIBLE_VIEW_TYPE;
}

/**
 * Convenience wrapper that pulls the active MarkdownView off the
 * workspace and short-circuits to `null` when the active leaf is not
 * a Markdown view.
 *
 * Why a separate helper:
 *  - Call sites that only need "the currently eligible view" should
 *    NOT have to import `MarkdownView` themselves (avoids dragging
 *    the obsidian type tree into pure modules like the runtime).
 *  - The implementation is one line; the value is in the type:
 *    callers get a non-null `MarkdownView` when the predicate passes.
 */
export interface PageletWorkspaceLike {
    getActiveViewOfType: Workspace["getActiveViewOfType"];
}

/**
 * Return the currently active MarkdownView, or `null` when the active
 * leaf is not a Markdown view.
 *
 * Note: `markdownViewCtor` is injected so this module stays usable in
 * the (small) set of contexts where importing `MarkdownView` from
 * obsidian would create a cycle. Production callers pass
 * `MarkdownView` directly.
 */
export function getActiveMarkdownView(
    workspace: PageletWorkspaceLike,
    markdownViewCtor: new (...args: unknown[]) => MarkdownView,
): MarkdownView | null {
    const view = workspace.getActiveViewOfType(markdownViewCtor) ?? null;
    if (!isPageletEligibleView(view as unknown as PageletViewTypeProbe | null)) return null;
    return view;
}

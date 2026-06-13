/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Mascot DOM renderer.
 *
 * Spec source: `docs/review-assistant-sdd.md` §10.1 + `docs/pagelet-visual-spec.html`.
 *
 * Responsibility split:
 *  - `markup.ts` decides WHAT the markup looks like for a given state.
 *  - This file decides HOW to mount and incrementally update real DOM.
 *
 * Why a class (not a plain function):
 *  - State transitions need a stable handle (`setState(newState)`).
 *    Closures over the parent would also work but a class makes
 *    intent obvious and pairs nicely with `destroy()` for teardown.
 *
 * Why NOT React/Preact/templating:
 *  - PA's existing UI uses raw DOM (`chat-view.ts`, settings panes).
 *    Adding a UI framework just for the mascot would balloon main.js
 *    by a few KB for ~10 DOM nodes.
 *
 * Why explicit `createElementNS` for SVG:
 *  - The Obsidian `createEl` extension does NOT set the SVG namespace
 *    so paths render as HTML divs (invisible). Hand-rolling avoids
 *    that footgun. The chat-view module hit the same issue (see
 *    `createSvgChild` there).
 *
 * Why we don't fully unit-test this file:
 *  - Without jsdom in the jest config, real DOM creation isn't
 *    exercisable. The smoke test in `pagelet-mascot.test.ts` uses
 *    a minimal stub host instead. The markup logic — which is what
 *    drives end-user visuals — IS fully covered via `buildMascotMarkup`.
 */

import {
    pageletT,
    type PageletLocale,
} from "../../../locales/pagelet";
import {
    buildMascotMarkup,
    MASCOT_STATE_I18N_KEY,
    type MascotMarkup,
} from "./markup";
import {
    MASCOT_STATE_ANNOUNCE_I18N_KEY,
    MASCOT_STATE_LIVE_LEVEL,
    type MascotLiveAnnouncement,
    type MascotLiveLevel,
    type MascotRenderer,
    type MascotRendererOptions,
    type MascotSetStateOptions,
    type MascotState,
    type MascotTranslator,
} from "./types";

// ---------------------------------------------------------------------------
// DOM host abstraction
//
// `MascotDomHost` is the minimum surface this file needs from a DOM
// implementation. The default real implementation uses `document.*`;
// tests can supply a recording host without depending on jsdom.
//
// We deliberately keep this PRIVATE to the mascot module — exporting it
// would tempt callers into building their own DOM hosts for application
// code, which is exactly the kind of layering churn we want to avoid.
// ---------------------------------------------------------------------------

/**
 * Lightweight HTMLElement-ish surface. Both real `HTMLElement` and the
 * test stub satisfy it. The methods are intentionally narrow to keep
 * the renderer code straightforward.
 */
export interface MascotDomNode {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    appendChild<T extends MascotDomNode>(child: T): T;
    removeChild(child: MascotDomNode): MascotDomNode;
    setText(text: string): void;
    setClassList(classes: readonly string[]): void;
    setStyleProperty(name: string, value: string): void;
    /** Detach this node from its parent if attached. */
    remove(): void;
}

export interface MascotDomHost {
    /** Create an HTML element by tag name (e.g. "div", "span"). */
    createHtmlElement(tag: string): MascotDomNode;
    /** Create an SVG element by tag name (e.g. "svg", "path", "circle"). */
    createSvgElement(tag: string): MascotDomNode;
}

// ---------------------------------------------------------------------------
// Default real-DOM host — used in production.
// ---------------------------------------------------------------------------

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

class RealDomNode implements MascotDomNode {
    constructor(private readonly el: Element) { }

    setAttribute(name: string, value: string): void {
        this.el.setAttribute(name, value);
    }
    removeAttribute(name: string): void {
        this.el.removeAttribute(name);
    }
    appendChild<T extends MascotDomNode>(child: T): T {
        const target = (child as unknown as RealDomNode).el;
        this.el.appendChild(target);
        return child;
    }
    removeChild(child: MascotDomNode): MascotDomNode {
        this.el.removeChild((child as RealDomNode).el);
        return child;
    }
    setText(text: string): void {
        this.el.textContent = text;
    }
    setClassList(classes: readonly string[]): void {
        // setAttribute("class", ...) replaces the whole list atomically,
        // which is what we want for state transitions. classList.add
        // would leak the previous state's class.
        this.el.setAttribute("class", classes.join(" "));
    }
    setStyleProperty(name: string, value: string): void {
        // HTMLElement vs SVGElement both expose `.style.setProperty`
        // — defensive guard for the rare host that doesn't.
        const styled = this.el as Element & { style?: { setProperty?: (n: string, v: string) => void } };
        styled.style?.setProperty?.(name, value);
    }
    remove(): void {
        if (this.el.parentElement) {
            this.el.parentElement.removeChild(this.el);
        }
    }
    /** Test/debug accessor — NOT in the interface, used only by the renderer. */
    raw(): Element {
        return this.el;
    }
}

class RealDomHost implements MascotDomHost {
    createHtmlElement(tag: string): MascotDomNode {
        return new RealDomNode(document.createElement(tag));
    }
    createSvgElement(tag: string): MascotDomNode {
        return new RealDomNode(document.createElementNS(SVG_NAMESPACE, tag));
    }
}

/** Wrap an existing real HTMLElement as a `MascotDomNode`. */
function wrapRealElement(el: Element): MascotDomNode {
    return new RealDomNode(el);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface MountedNodes {
    root: MascotDomNode;
    svg: MascotDomNode;
    messageEl: MascotDomNode;
    /**
     * Hidden aria-live region for state announcements (B5 §6.2). Lives
     * inside the mascot root so the same screen-reader cursor that
     * tracks the mascot also picks up the announcement, but visually
     * hidden via the `pa-pagelet-mascot__live` class (see CSS spec).
     */
    liveEl: MascotDomNode;
}

/**
 * Internal options used by `createMascotRendererWithHost`. Allows the
 * test stub to inject a recording host without exposing the host
 * interface to production callers.
 */
interface InternalRendererOptions extends MascotRendererOptions {
    host: MascotDomHost;
}

/**
 * Production entry point. Mounts under the given real parent element.
 *
 * Caller responsibilities:
 *   - Hold the returned `MascotRenderer` for the lifetime of the view.
 *   - Call `destroy()` from the view's onunload hook.
 *
 * The initial state is rendered synchronously so the mascot is visible
 * before the first `setState` call.
 */
export function createMascotRenderer(
    parentEl: HTMLElement,
    options: MascotRendererOptions = {},
): MascotRenderer {
    return createMascotRendererWithHost(wrapRealElement(parentEl), {
        ...options,
        host: new RealDomHost(),
    });
}

/**
 * Lower-level entry point used by tests with a stub host. Production
 * callers should use `createMascotRenderer` instead.
 *
 * Exposed only via the `mascot/index.ts` barrel for testing; the
 * `pagelet/index.ts` re-export deliberately omits it.
 */
export function createMascotRendererWithHost(
    parentNode: MascotDomNode,
    options: InternalRendererOptions,
): MascotRenderer {
    const locale = options.locale ?? "en";
    const translator = options.translator ?? defaultTranslator(locale);
    const dataPlugin = options.dataPlugin ?? "pa-pagelet";
    const ariaLabelOverride = options.ariaLabel;
    const prefersReducedMotion = options.prefersReducedMotion ?? defaultPrefersReducedMotion;
    const announceLiveRegion = options.announceLiveRegion;
    let currentState: MascotState = options.initialState ?? "idle";
    // Lifecycle guard: once `destroy()` runs, every subsequent `setState` /
    // announcement must be a no-op. Without this, a late status broadcast
    // (e.g. from an in-flight review that finished after the view closed)
    // would mutate a detached DOM and still fire the `announceLiveRegion`
    // seam, surfacing ghost announcements to screen readers.
    let destroyed = false;

    const initialReducedMotion = safeProbeReducedMotion(prefersReducedMotion);
    const mounted = mountInitial({
        host: options.host,
        parentNode,
        dataPlugin,
        markup: buildMascotMarkup(currentState, {
            translator,
            ariaLabel: ariaLabelOverride,
            reducedMotion: initialReducedMotion,
        }),
    });
    // Mount-time announcement: if the initial state is one of the
    // announcing states (rare but possible — e.g. a host restoring
    // mascot from a saved "error" state), emit immediately.
    emitAnnouncement(currentState, translator, mounted, announceLiveRegion);

    function applyState(newState: MascotState, opts?: MascotSetStateOptions): void {
        // Guard 0: post-destroy calls are silently dropped. The renderer
        // is unusable after destroy() — surfacing a noisy error would
        // turn benign late-callbacks into user-visible failures.
        if (destroyed) return;
        // Guard 1: abort signal short-circuits the transition.
        if (opts?.signal?.aborted) return;
        // Guard 2: skip if the state and message are identical (a
        // common case during rapid status broadcasts) — avoids a
        // pointless DOM mutation.
        if (newState === currentState && opts?.message === undefined) return;

        const reducedMotion = safeProbeReducedMotion(prefersReducedMotion);
        const markup = buildMascotMarkup(newState, {
            translator,
            messageOverride: opts?.message,
            ariaLabel: ariaLabelOverride,
            reducedMotion,
        });
        applyMarkup(mounted, markup, options.host);
        const stateChanged = newState !== currentState;
        currentState = newState;
        // Only announce on a real state transition. Re-renders that
        // only swap the message (same state) should not re-announce
        // — that would spam screen readers on rapid "Reviewing X..."
        // status updates.
        if (stateChanged) {
            emitAnnouncement(newState, translator, mounted, announceLiveRegion);
        }
    }

    return {
        get state(): MascotState {
            return currentState;
        },
        setState: applyState,
        destroy(): void {
            if (destroyed) return;
            destroyed = true;
            mounted.root.remove();
        },
    };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function mountInitial(args: {
    host: MascotDomHost;
    parentNode: MascotDomNode;
    dataPlugin: string;
    markup: MascotMarkup;
}): MountedNodes {
    const { host, parentNode, dataPlugin, markup } = args;

    const root = host.createHtmlElement("div");
    root.setAttribute("data-plugin", dataPlugin);
    // The visual mascot is a labelled group. State announcements are isolated
    // in the hidden live region below so assistive tech does not announce the
    // same transition twice.
    root.setAttribute("role", "group");

    const svg = host.createSvgElement("svg");
    svg.setAttribute("xmlns", SVG_NAMESPACE);
    svg.setAttribute("focusable", "false");
    svg.setAttribute("aria-hidden", "true");
    // Make the SVG inherit the root's stroke color via currentColor;
    // root color is set per-state via a CSS custom property below.
    svg.setAttribute("fill", "none");
    root.appendChild(svg);

    const messageEl = host.createHtmlElement("span");
    messageEl.setAttribute("class", "pa-pagelet-mascot__message");
    root.appendChild(messageEl);

    // Visually hidden aria-live region for state announcements.
    // `aria-live` defaults to "off" at mount time — `applyAnnouncement`
    // toggles it per state so AT only picks up real transitions.
    const liveEl = host.createHtmlElement("span");
    liveEl.setAttribute("class", "pa-pagelet-mascot__live");
    liveEl.setAttribute("aria-live", "off");
    // `aria-atomic="true"` so AT re-reads the whole announcement instead
    // of trying to diff. Atomic is correct for short status messages.
    liveEl.setAttribute("aria-atomic", "true");
    // `role="status"` is scoped to the dedicated live element rather than
    // duplicated on the visual root.
    liveEl.setAttribute("role", "status");
    root.appendChild(liveEl);

    parentNode.appendChild(root);

    const mounted: MountedNodes = { root, svg, messageEl, liveEl };
    applyMarkup(mounted, markup, host);
    return mounted;
}

function applyMarkup(
    mounted: MountedNodes,
    markup: MascotMarkup,
    host: MascotDomHost,
): void {
    mounted.root.setClassList(markup.rootClassList);
    mounted.root.setAttribute("data-mascot-state", markup.state);
    mounted.root.setAttribute("aria-label", markup.ariaLabel);
    // Stroke color is set as a CSS custom property on the root so the
    // SVG paths can reference `var(--pa-pagelet-mascot-stroke)` and
    // theme overrides flow naturally.
    mounted.root.setStyleProperty("--pa-pagelet-mascot-stroke", markup.strokeColor);

    mounted.messageEl.setText(markup.message);

    // Rebuild the SVG children (cheap — 4-6 nodes max). Replacing the
    // whole tree avoids state-leak bugs where e.g. the error state's
    // mouth lingers after switching back to idle.
    rebuildSvgChildren(mounted.svg, markup, host);
}

function rebuildSvgChildren(
    svg: MascotDomNode,
    markup: MascotMarkup,
    host: MascotDomHost,
): void {
    // Replace children: easiest portable approach is to set innerHTML
    // on the underlying element. But our node abstraction doesn't have
    // that, so we use a hand-rolled `removeAllChildren` shim via the
    // host. The real DOM implementation falls back to repeated
    // removeChild calls — the test stub records them.
    clearChildren(svg);
    svg.setAttribute("viewBox", markup.svgViewBox);

    for (const path of markup.svgShapes.paths) {
        const pathEl = host.createSvgElement("path");
        pathEl.setAttribute("d", path.d);
        pathEl.setAttribute("stroke", markup.strokeColor);
        pathEl.setAttribute("stroke-width", String(path.strokeWidth));
        pathEl.setAttribute("stroke-linecap", "round");
        pathEl.setAttribute("stroke-linejoin", "round");
        pathEl.setAttribute("fill", "none");
        if (path.animClass) pathEl.setAttribute("class", path.animClass);
        svg.appendChild(pathEl);
    }

    if (markup.svgShapes.circles) {
        for (const circle of markup.svgShapes.circles) {
            const circleEl = host.createSvgElement("circle");
            circleEl.setAttribute("cx", String(circle.cx));
            circleEl.setAttribute("cy", String(circle.cy));
            circleEl.setAttribute("r", String(circle.r));
            circleEl.setAttribute("fill", markup.strokeColor);
            if (circle.animClass) circleEl.setAttribute("class", circle.animClass);
            svg.appendChild(circleEl);
        }
    }
}

function clearChildren(node: MascotDomNode): void {
    // Optional "shortcut": some hosts expose a dedicated clear method
    // (e.g. real Element via `replaceChildren`). Honor it when present.
    const maybeClear = node as MascotDomNode & { clearChildren?: () => void };
    if (typeof maybeClear.clearChildren === "function") {
        maybeClear.clearChildren();
        return;
    }
    // Fallback: try `replaceChildren` on a real Element wrapper.
    // `replaceChildren` was added in Safari 14 / Chrome 86; iOS 13's
    // WKWebView (still in the field for older Obsidian Mobile installs)
    // throws "undefined is not a function". On that path we fall through
    // to a manual removeChild loop — otherwise the SVG accumulates
    // overlapping paths on every setState and the DOM leaks per
    // transition.
    const real = node as MascotDomNode & { raw?: () => Element };
    if (typeof real.raw === "function") {
        const el = real.raw();
        try {
            (el as Element & { replaceChildren?: () => void }).replaceChildren?.();
            // If `replaceChildren` was missing entirely (iOS 13 etc.), `?.()`
            // returns undefined without throwing. Check that the children
            // actually went away; if not, fall through to the manual loop.
            if (!el.firstChild) return;
        } catch {
            // `replaceChildren` threw — fall through to the manual loop.
        }
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
        return;
    }
    // The host abstraction does not expose iteration over children;
    // recording-host tests handle clearing via their own counter.
    // The production path above always wins. This branch exists so
    // the test stub can simply implement `clearChildren` and we won't
    // double-remove.
}

function defaultTranslator(locale: PageletLocale): MascotTranslator {
    return (key: string, fallback?: string) => pageletT(key, locale, undefined, fallback);
}

/**
 * Default `prefers-reduced-motion` probe.
 *
 * Lazy `window.matchMedia` lookup — invoked on every `setState` call,
 * NOT cached at module-load — so a user who toggles their OS reduce-
 * motion preference mid-session takes effect on the next mascot
 * transition (no listener overhead required).
 *
 * Defensive `try/catch` because some Obsidian environments (mobile
 * preview, certain WebViews) throw when matchMedia is called with a
 * not-yet-recognized media query string.
 */
function defaultPrefersReducedMotion(): boolean {
    if (typeof window === "undefined") return false;
    const mm = (window as Window & { matchMedia?: typeof window.matchMedia }).matchMedia;
    if (typeof mm !== "function") return false;
    try {
        return mm.call(window, "(prefers-reduced-motion: reduce)").matches === true;
    } catch {
        return false;
    }
}

/**
 * Bullet-proof wrapper around the user-supplied probe — a thrown
 * exception must not interrupt the mascot transition.
 */
function safeProbeReducedMotion(probe: () => boolean): boolean {
    try {
        return probe() === true;
    } catch {
        return false;
    }
}

/**
 * Emit a state announcement to the live region. Updates BOTH the
 * `aria-live` attribute (so AT picks the right priority) AND the text
 * (so AT speaks it). Calls the optional caller seam for tests / custom
 * routing.
 */
function emitAnnouncement(
    state: MascotState,
    translator: MascotTranslator,
    mounted: MountedNodes,
    announceLiveRegion: ((announcement: MascotLiveAnnouncement) => void) | undefined,
): void {
    const level: MascotLiveLevel = MASCOT_STATE_LIVE_LEVEL[state];
    const messageKey = MASCOT_STATE_ANNOUNCE_I18N_KEY[state];
    const message = messageKey
        ? lookupAnnouncementMessage(messageKey, translator)
        : "";

    mounted.liveEl.setAttribute("aria-live", level);
    mounted.liveEl.setText(message);

    if (announceLiveRegion) {
        announceLiveRegion({ state, message, level });
    }
}

/**
 * Resolve the announcement string, falling through to a sensible EN
 * default when the translator surfaces the raw key (same pattern the
 * mascot message resolver uses).
 */
function lookupAnnouncementMessage(key: string, translator: MascotTranslator): string {
    const fallback = ANNOUNCE_DEFAULT_TEXT[key] ?? "";
    const raw = translator(key, fallback);
    return raw === key ? fallback : raw;
}

/** Hard-coded EN fallbacks for the announcement keys. */
const ANNOUNCE_DEFAULT_TEXT: Readonly<Record<string, string>> = Object.freeze({
    "pagelet.a11y.announce.done": "Pagelet finished reviewing. Suggestions are ready.",
    "pagelet.a11y.announce.error": "Pagelet review failed. Open the panel for details.",
});

// ---------------------------------------------------------------------------
// Re-exports — keep the mascot/index.ts barrel slim.
// ---------------------------------------------------------------------------

export { MASCOT_STATE_I18N_KEY };

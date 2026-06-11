/* Copyright 2023 edonyzpc */

/**
 * Pet v2 DOM lifecycle manager.
 *
 * Owns: wrapper div, SVG element, notification dot, event listeners.
 * Does NOT own: the state machine or analysis pipeline. Callers drive
 * state via `setState()`.
 */

import type { PetCallbacks, PetCorner, PetRenderer, PetRendererOptions, PetState } from "./types";
import { buildPetSvg, updatePetSvgState } from "./PetSvg";
import { PetStateMachine } from "./PetStateMachine";

// ---------------------------------------------------------------------------
// CSS — injected once via <style> on first mount (same pattern as BubbleView)
// ---------------------------------------------------------------------------

const PET_CSS_ID = "pa-pagelet-pet-styles";

const PET_CSS = /* css */ `
@keyframes pa-pagelet-pet-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
@keyframes pa-pagelet-pet-breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.02)} }
@keyframes pa-pagelet-pet-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
@keyframes pa-pagelet-pet-bounce { 0%,100%{transform:translateY(0)} 25%{transform:translateY(-8px)} 45%{transform:translateY(-2px)} 65%{transform:translateY(-6px)} 85%{transform:translateY(-1px)} }
@keyframes pa-pagelet-pet-blink { 0%,92%,100%{transform:scaleY(1)} 95%{transform:scaleY(0.1)} }
@keyframes pa-pagelet-pet-dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes pa-pagelet-pet-nudge-dot-glow { 0%,100%{box-shadow:0 0 4px var(--pagelet-done,#5dd39e);transform:scale(1)} 50%{box-shadow:0 0 12px var(--pagelet-done,#5dd39e),0 0 24px rgba(93,211,158,0.35);transform:scale(1.15)} }
@keyframes pa-pagelet-pet-zzz-float-1 { 0%{transform:translate(0,0) scale(1);opacity:0.5} 100%{transform:translate(4px,-14px) scale(0.8);opacity:0} }
@keyframes pa-pagelet-pet-zzz-float-2 { 0%{transform:translate(0,0) scale(1);opacity:0.35} 100%{transform:translate(6px,-18px) scale(0.7);opacity:0} }

.pa-pagelet-pet { position:absolute; z-index:1000; cursor:pointer; user-select:none; -webkit-user-select:none; transition:filter 0.4s ease,opacity 0.4s ease; }
.pa-pagelet-pet[data-corner="bottom-right"] { bottom:36px; right:20px; }
.pa-pagelet-pet[data-corner="bottom-left"]  { bottom:36px; left:8px; }
.pa-pagelet-pet[data-corner="top-right"]    { top:48px; right:20px; }
.pa-pagelet-pet[data-corner="top-left"]     { top:48px; left:8px; }
.pa-pagelet-pet-wrapper { width:56px; height:56px; display:flex; align-items:center; justify-content:center; position:relative; }
.pa-pagelet-pet-notification { position:absolute; top:-2px; right:-4px; width:12px; height:12px; background:var(--pagelet-done,#5dd39e); border-radius:50%; border:2px solid var(--background-primary,#1e1e1e); opacity:0; transform:scale(0); transition:all 0.3s ease; pointer-events:none; }
.pa-pagelet-pet[data-state="nudge"] .pa-pagelet-pet-notification { opacity:1; transform:scale(1); animation:pa-pagelet-pet-nudge-dot-glow 1.8s ease-in-out infinite; }
.pa-pagelet-pet[data-state="resting"] { opacity:0.55; }
.pa-pagelet-pet[data-state="working"],.pa-pagelet-pet[data-state="nudge"],.pa-pagelet-pet[data-state="idle"] { opacity:1; }
.pa-pagelet-pet[data-state="idle"] .pa-pagelet-pet-svg-wrap { animation:pa-pagelet-pet-float 2.8s ease-in-out infinite; }
.pa-pagelet-pet[data-state="resting"] .pa-pagelet-pet-svg-wrap { animation:pa-pagelet-pet-breathe 5s ease-in-out infinite; }
.pa-pagelet-pet[data-state="working"] .pa-pagelet-pet-svg-wrap { animation:pa-pagelet-pet-pulse 1.4s ease-in-out infinite; }
.pa-pagelet-pet[data-state="nudge"] .pa-pagelet-pet-svg-wrap { animation:pa-pagelet-pet-bounce 1.6s ease-in-out infinite; }
.pa-pagelet-pet[data-state="idle"] .pa-pagelet-pet-blink-group,.pa-pagelet-pet[data-state="nudge"] .pa-pagelet-pet-blink-group { animation:pa-pagelet-pet-blink 5s infinite; transform-origin:center; }
.pa-pagelet-pet[data-state="working"] .pa-pagelet-pet-dot-1 { animation:pa-pagelet-pet-dot-pulse 1.4s infinite 0s; }
.pa-pagelet-pet[data-state="working"] .pa-pagelet-pet-dot-2 { animation:pa-pagelet-pet-dot-pulse 1.4s infinite 0.2s; }
.pa-pagelet-pet[data-state="working"] .pa-pagelet-pet-dot-3 { animation:pa-pagelet-pet-dot-pulse 1.4s infinite 0.4s; }
.pa-pagelet-pet[data-state="resting"] .pa-pagelet-pet-zzz-1 { animation:pa-pagelet-pet-zzz-float-1 3s ease-out infinite; }
.pa-pagelet-pet[data-state="resting"] .pa-pagelet-pet-zzz-2 { animation:pa-pagelet-pet-zzz-float-2 3s ease-out infinite 0.8s; }
.pa-pagelet-pet--error .pa-pagelet-pet-svg-wrap svg path,.pa-pagelet-pet--error .pa-pagelet-pet-svg-wrap svg circle { stroke:#ff6b6b !important; fill:none; }
.theme-light .pa-pagelet-pet-wrapper,[data-theme="light"] .pa-pagelet-pet-wrapper { background:rgba(255,255,255,0.75); border-radius:10px; box-shadow:0 2px 12px rgba(0,0,0,0.10),0 1px 4px rgba(0,0,0,0.06); }
.theme-light .pa-pagelet-pet[data-state="resting"],[data-theme="light"] .pa-pagelet-pet[data-state="resting"] { opacity:0.4; }
.theme-light .pa-pagelet-pet[data-state="resting"] .pa-pagelet-pet-svg-wrap,[data-theme="light"] .pa-pagelet-pet[data-state="resting"] .pa-pagelet-pet-svg-wrap { filter:saturate(0) brightness(0.85); }
.theme-light .pa-pagelet-pet[data-state="working"] .pa-pagelet-pet-wrapper,[data-theme="light"] .pa-pagelet-pet[data-state="working"] .pa-pagelet-pet-wrapper { box-shadow:0 2px 16px rgba(124,158,255,0.3),0 0 0 1.5px rgba(124,158,255,0.4); }
.theme-light .pa-pagelet-pet[data-state="nudge"] .pa-pagelet-pet-wrapper,[data-theme="light"] .pa-pagelet-pet[data-state="nudge"] .pa-pagelet-pet-wrapper { box-shadow:0 2px 20px rgba(93,211,158,0.35),0 0 0 2px rgba(93,211,158,0.2); }
body.is-mobile .pa-pagelet-pet-wrapper { transform:scale(0.8); min-width:44px; min-height:44px; }
@media(prefers-reduced-motion:reduce) { .pa-pagelet-pet[data-state] .pa-pagelet-pet-svg-wrap,.pa-pagelet-pet[data-state] .pa-pagelet-pet-blink-group,.pa-pagelet-pet-notification,.pa-pagelet-pet-dot-1,.pa-pagelet-pet-dot-2,.pa-pagelet-pet-dot-3,.pa-pagelet-pet[data-state="resting"] .pa-pagelet-pet-zzz-1,.pa-pagelet-pet[data-state="resting"] .pa-pagelet-pet-zzz-2 { animation:none !important; } }
`;

function injectPetStyles(): void {
    if (document.getElementById(PET_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = PET_CSS_ID;
    style.textContent = PET_CSS;
    document.head.appendChild(style);
}

export class PetView implements PetRenderer {
    private _state: PetState;
    private _corner: PetCorner;
    private readonly _callbacks: PetCallbacks;
    private readonly _stateMachine: PetStateMachine;

    private _rootEl: HTMLDivElement | null = null;
    private _svgWrapEl: HTMLDivElement | null = null;
    private _svgEl: SVGElement | null = null;
    private _containerEl: HTMLElement | null = null;
    private _destroyed = false;
    private _errorTimer: ReturnType<typeof setTimeout> | null = null;
    private _themeObserver: MutationObserver | null = null;

    // Bound handlers for clean removal
    private readonly _handleClick: (e: MouseEvent) => void;
    private readonly _handleKeydown: (e: KeyboardEvent) => void;
    private readonly _handleTouchend: (e: TouchEvent) => void;

    constructor(options: PetRendererOptions) {
        this._state = options.initialState ?? "idle";
        this._corner = options.corner ?? "bottom-right";
        this._callbacks = options.callbacks;

        this._stateMachine = new PetStateMachine({
            initialState: this._state,
            onTransition: (_prev, next) => {
                this._state = next;
                this.applyState();
            },
        });

        this._handleClick = () => {
            this._callbacks.onToggleBubble();
        };
        this._handleKeydown = (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this._callbacks.onToggleBubble();
            }
        };
        this._handleTouchend = (e: TouchEvent) => {
            e.preventDefault();
            this._callbacks.onToggleBubble();
        };
    }

    /** Mount the Pet into a container element (the markdown view's content area). */
    mount(containerEl: HTMLElement): void {
        if (this._destroyed) return;
        if (this._rootEl) return; // already mounted

        injectPetStyles();
        this._containerEl = containerEl;

        // Build DOM structure
        const root = document.createElement("div");
        root.className = "pa-pagelet-pet";
        root.setAttribute("data-state", this._state);
        root.setAttribute("data-corner", this._corner);
        root.setAttribute("tabindex", "0");
        root.setAttribute("role", "button");
        root.setAttribute("aria-label", "拾页助手");

        const wrapper = document.createElement("div");
        wrapper.className = "pa-pagelet-pet-wrapper";

        const notification = document.createElement("div");
        notification.className = "pa-pagelet-pet-notification";

        const svgWrap = document.createElement("div");
        svgWrap.className = "pa-pagelet-pet-svg-wrap";

        // Parse SVG string into a real SVG element
        const svgMarkup = buildPetSvg(this._state);
        const template = document.createElement("template");
        template.innerHTML = svgMarkup;
        const svgEl = template.content.firstElementChild as SVGElement;

        svgWrap.appendChild(svgEl);
        wrapper.appendChild(notification);
        wrapper.appendChild(svgWrap);
        root.appendChild(wrapper);

        // Event listeners
        root.addEventListener("click", this._handleClick);
        root.addEventListener("keydown", this._handleKeydown);
        root.addEventListener("touchend", this._handleTouchend, { passive: false });

        containerEl.appendChild(root);

        this._rootEl = root;
        this._svgWrapEl = svgWrap;
        this._svgEl = svgEl;

        // Apply theme-aware colors
        this.applyThemeColors();

        // Watch for theme changes (light ↔ dark)
        this._themeObserver = new MutationObserver(() => {
            this.applyThemeColors();
        });
        this._themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ["class"],
        });
    }

    /** Unmount from current container. */
    unmount(): void {
        if (!this._rootEl) return;

        this._themeObserver?.disconnect();
        this._themeObserver = null;

        this._rootEl.removeEventListener("click", this._handleClick);
        this._rootEl.removeEventListener("keydown", this._handleKeydown);
        this._rootEl.removeEventListener("touchend", this._handleTouchend);

        this._rootEl.remove();
        this._rootEl = null;
        this._svgWrapEl = null;
        this._svgEl = null;
        this._containerEl = null;
    }

    get rootEl(): HTMLElement | null {
        return this._rootEl;
    }

    get state(): PetState {
        return this._state;
    }

    /** Set state (delegates to state machine, which triggers applyState). */
    setState(state: PetState): void {
        if (this._destroyed) return;
        if (state === this._state) return;
        this._stateMachine.forceState(state);
    }

    /** Expose the state machine for event-driven transitions. */
    get stateMachine(): PetStateMachine {
        return this._stateMachine;
    }

    /** Set corner position. */
    setCorner(corner: PetCorner): void {
        if (this._destroyed) return;
        this._corner = corner;
        this._rootEl?.setAttribute("data-corner", corner);
    }

    get corner(): PetCorner {
        return this._corner;
    }

    /** Flash error state for a duration then restore the previous state. */
    flashError(durationMs = 1500): void {
        if (this._destroyed) return;
        if (this._errorTimer !== null) {
            clearTimeout(this._errorTimer);
        }

        this._rootEl?.setAttribute("data-state", "error");
        this._rootEl?.classList.add("pa-pagelet-pet--error");

        this._errorTimer = setTimeout(() => {
            this._errorTimer = null;
            if (this._destroyed) return;
            this._rootEl?.classList.remove("pa-pagelet-pet--error");
            // Read current state from state machine (not a stale capture)
            this._state = this._stateMachine.state;
            this.applyState();
        }, durationMs);
    }

    /** Clean up all resources. */
    destroy(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._errorTimer !== null) {
            clearTimeout(this._errorTimer);
            this._errorTimer = null;
        }
        this.unmount();
        document.getElementById(PET_CSS_ID)?.remove();
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private applyState(): void {
        if (!this._rootEl || !this._svgEl) return;
        this._rootEl.setAttribute("data-state", this._state);
        this.applyThemeColors();
    }

    private applyThemeColors(): void {
        if (!this._svgEl) return;
        const isLight = this.detectLightTheme();
        updatePetSvgState(this._svgEl, this._state, isLight);
    }

    private detectLightTheme(): boolean {
        if (!this._rootEl) return false;
        // Walk up to find a [data-theme="light"] ancestor or check
        // common Obsidian theme classes.
        const root = document.documentElement;
        if (root.getAttribute("data-theme") === "light") return true;
        if (document.body.classList.contains("theme-light")) return true;
        return false;
    }
}

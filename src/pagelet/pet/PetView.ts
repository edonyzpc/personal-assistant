/* Copyright 2023 edonyzpc */

/**
 * Pagelet Pet DOM lifecycle manager.
 *
 * Owns: wrapper div, SVG element, notification dot, event listeners.
 * Does NOT own: the state machine or analysis pipeline. Callers drive
 * state via `setState()`.
 */

import type { PetCallbacks, PetCorner, PetRenderer, PetRendererOptions, PetState, PetTaskKind } from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import { clearPlatformTimeout, getPlatformDocument, setPlatformTimeout, type PlatformTimeoutHandle } from "../../platform-dom";
import { createHtmlElement } from "../dom-utils";
import { createPetSvgElement, updatePetSvgState } from "./PetSvg";
import { PetStateMachine } from "./PetStateMachine";

export function getPetAriaLabel(locale: PageletLocale, state?: PetState, taskKind?: PetTaskKind): string {
    const base = pageletT("pagelet.pet.ariaLabel", locale);
    if (state === "working" && taskKind) {
        return `${base}: ${pageletT(`pagelet.pet.task.${taskKind}`, locale)}`;
    }
    return state ? `${base}: ${pageletT(`pagelet.pet.${state}`, locale)}` : base;
}

export class PetView implements PetRenderer {
    private _state: PetState;
    private _taskKind: PetTaskKind;
    private _corner: PetCorner;
    private readonly _callbacks: PetCallbacks;
    private readonly _stateMachine: PetStateMachine;

    private _rootEl: HTMLDivElement | null = null;
    private _svgWrapEl: HTMLDivElement | null = null;
    private _svgEl: SVGElement | null = null;
    private _containerEl: HTMLElement | null = null;
    private _destroyed = false;
    private _recentTouch = false;
    private _touchSuppressTimer: PlatformTimeoutHandle | null = null;
    private _errorTimer: PlatformTimeoutHandle | null = null;
    private _themeObserver: MutationObserver | null = null;
    private readonly _getLocale: () => PageletLocale;

    // Bound handlers for clean removal
    private readonly _handleClick: (e: MouseEvent) => void;
    private readonly _handleKeydown: (e: KeyboardEvent) => void;
    private readonly _handleTouchend: (e: TouchEvent) => void;

    constructor(options: PetRendererOptions) {
        this._state = options.initialState ?? "idle";
        this._taskKind = options.initialTaskKind ?? "review";
        this._corner = options.corner ?? "bottom-right";
        this._callbacks = options.callbacks;
        this._getLocale = options.getLocale ?? (() => "en");

        this._stateMachine = new PetStateMachine({
            initialState: this._state,
            onTransition: (_prev, next) => {
                this._state = next;
                this.applyState();
            },
        });

        this._handleClick = () => {
            if (this._recentTouch) return;
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
            this._recentTouch = true;
            this.clearTouchSuppression();
            this._touchSuppressTimer = setPlatformTimeout(() => {
                this._touchSuppressTimer = null;
                if (this._destroyed) return;
                this._recentTouch = false;
            }, 400);
            this._callbacks.onToggleBubble();
        };
    }

    /** Mount the Pet into a container element (the markdown view's content area). */
    mount(containerEl: HTMLElement): void {
        if (this._destroyed) return;
        if (this._rootEl) return; // already mounted

        this._containerEl = containerEl;

        // Build DOM structure
        const root = createHtmlElement("div");
        root.className = "pa-pagelet-pet";
        root.setAttribute("data-state", this._state);
        root.setAttribute("data-task", this._taskKind);
        root.setAttribute("data-corner", this._corner);
        root.setAttribute("tabindex", "0");
        root.setAttribute("role", "button");
        root.setAttribute("aria-label", getPetAriaLabel(this._getLocale(), this._state, this._taskKind));
        root.setAttribute("aria-live", "polite");

        const wrapper = createHtmlElement("div");
        wrapper.className = "pa-pagelet-pet-wrapper";

        const notification = createHtmlElement("div");
        notification.className = "pa-pagelet-pet-notification";

        const svgWrap = createHtmlElement("div");
        svgWrap.className = "pa-pagelet-pet-svg-wrap";

        const svgEl = createPetSvgElement(this._state, this._taskKind);

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
        this._themeObserver.observe(getPlatformDocument().body, {
            attributes: true,
            attributeFilter: ["class"],
        });
    }

    /** Unmount from current container. */
    unmount(): void {
        if (!this._rootEl) return;

        this.clearTouchSuppression();
        this._recentTouch = false;

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

    get taskKind(): PetTaskKind {
        return this._taskKind;
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

    /** Set the current task visualized while the Pet is working. */
    setTaskKind(taskKind: PetTaskKind): void {
        if (this._destroyed) return;
        if (taskKind === this._taskKind) return;
        this._taskKind = taskKind;
        this._rootEl?.setAttribute("data-task", taskKind);
        if (this._state === "working") {
            this._rootEl?.setAttribute("aria-label", getPetAriaLabel(this._getLocale(), this._state, this._taskKind));
            this.applyThemeColors();
        }
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
            clearPlatformTimeout(this._errorTimer);
        }

        this._rootEl?.setAttribute("data-state", "error");
        this._rootEl?.classList.add("pa-pagelet-pet--error");

        this._errorTimer = setPlatformTimeout(() => {
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
            clearPlatformTimeout(this._errorTimer);
            this._errorTimer = null;
        }
        this.clearTouchSuppression();
        this._recentTouch = false;
        this.unmount();
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private applyState(): void {
        if (!this._rootEl || !this._svgEl) return;
        this._rootEl.setAttribute("data-state", this._state);
        this._rootEl.setAttribute("data-task", this._taskKind);
        this._rootEl.setAttribute("aria-label", getPetAriaLabel(this._getLocale(), this._state, this._taskKind));
        this.applyThemeColors();
    }

    private clearTouchSuppression(): void {
        if (this._touchSuppressTimer !== null) {
            clearPlatformTimeout(this._touchSuppressTimer);
            this._touchSuppressTimer = null;
        }
    }

    private applyThemeColors(): void {
        if (!this._svgEl) return;
        const isLight = this.detectLightTheme();
        updatePetSvgState(this._svgEl, this._state, isLight, this._taskKind);
    }

    private detectLightTheme(): boolean {
        if (!this._rootEl) return false;
        // Walk up to find a [data-theme="light"] ancestor or check
        // common Obsidian theme classes.
        const doc = getPlatformDocument();
        const root = doc.documentElement;
        if (root.getAttribute("data-theme") === "light") return true;
        if (doc.body.classList.contains("theme-light")) return true;
        return false;
    }
}

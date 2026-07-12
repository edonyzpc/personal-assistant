/* Copyright 2023 edonyzpc */

/**
 * Pagelet Pet DOM lifecycle manager.
 *
 * Owns: wrapper div, SVG element, notification dot, event listeners.
 * Does NOT own: the state machine or analysis pipeline. Callers drive
 * state via `setState()`.
 */

import { Platform } from "obsidian";
import type { PetCallbacks, PetCorner, PetRenderer, PetRendererOptions, PetState, PetTaskKind } from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import {
    clearPlatformTimeout,
    getOptionalPlatformWindow,
    getPlatformDocument,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../../platform-dom";
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

export type PetMountTarget = {
    mountEl: HTMLElement;
    insertAfterEl: HTMLElement | null;
    mobileToolbar: boolean;
};

export function resolvePetMountTarget(containerEl: HTMLElement): PetMountTarget {
    const doc = containerEl.ownerDocument ?? getPlatformDocument();
    const win = doc.defaultView ?? getOptionalPlatformWindow();
    const viewportWidth = win?.innerWidth ?? doc.documentElement.clientWidth;
    const viewportHeight = win?.innerHeight ?? doc.documentElement.clientHeight;
    const shortEdge = Math.min(
        viewportWidth > 0 ? viewportWidth : Number.POSITIVE_INFINITY,
        viewportHeight > 0 ? viewportHeight : Number.POSITIVE_INFINITY,
    );
    const isDesktopPhoneSimulation = Platform.isDesktop
        && doc.body.classList.contains("is-mobile")
        && shortEdge <= 600;
    const isPhoneLayout = Platform.isPhone || isDesktopPhoneSimulation;
    if (!isPhoneLayout) {
        return { mountEl: containerEl, insertAfterEl: null, mobileToolbar: false };
    }

    // Scope the host lookup to the current Markdown leaf. A global query can
    // select chrome from another split leaf and recreate the same detached
    // overlay problem this path is meant to avoid.
    const leafContent = containerEl.closest<HTMLElement>(".workspace-leaf-content");
    const toolbarLeft = leafContent?.querySelector<HTMLElement>(".view-header-left") ?? null;
    if (!toolbarLeft) {
        return { mountEl: containerEl, insertAfterEl: null, mobileToolbar: false };
    }

    const sidebarToggle = toolbarLeft.querySelector<HTMLElement>(
        ".sidebar-toggle-button.mod-left",
    );
    return {
        mountEl: toolbarLeft,
        insertAfterEl: sidebarToggle?.parentElement === toolbarLeft ? sidebarToggle : null,
        mobileToolbar: true,
    };
}

const QUICK_CAPTURE_HOLD_MS = 520;

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
    private _quickCaptureHoldTriggered = false;
    private _touchSuppressTimer: PlatformTimeoutHandle | null = null;
    private _errorTimer: PlatformTimeoutHandle | null = null;
    private _quickCaptureHoldTimer: PlatformTimeoutHandle | null = null;
    private _themeObserver: MutationObserver | null = null;
    private readonly _getLocale: () => PageletLocale;

    // Bound handlers for clean removal
    private readonly _handleClick: (e: MouseEvent) => void;
    private readonly _handleKeydown: (e: KeyboardEvent) => void;
    private readonly _handleMouseDown: (e: MouseEvent) => void;
    private readonly _handleMouseUp: () => void;
    private readonly _handleMouseLeave: () => void;
    private readonly _handleTouchstart: (e: TouchEvent) => void;
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
            if (this.consumeQuickCaptureHold()) return;
            this._callbacks.onToggleBubble();
        };
        this._handleKeydown = (e: KeyboardEvent) => {
            if (e.shiftKey && e.key === "Enter") {
                e.preventDefault();
                this.openQuickCapture();
                return;
            }
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this._callbacks.onToggleBubble();
            }
        };
        this._handleMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            this.startQuickCaptureHold();
        };
        this._handleMouseUp = () => {
            this.clearQuickCaptureHoldTimer();
        };
        this._handleMouseLeave = () => {
            this.clearQuickCaptureHoldTimer();
            this._quickCaptureHoldTriggered = false;
            this._rootEl?.removeAttribute("data-capture-hold");
        };
        this._handleTouchstart = () => {
            this.startQuickCaptureHold();
        };
        this._handleTouchend = (e: TouchEvent) => {
            e.preventDefault();
            this._recentTouch = true;
            const holdTriggered = this.consumeQuickCaptureHold();
            this.clearTouchSuppression();
            this._touchSuppressTimer = setPlatformTimeout(() => {
                this._touchSuppressTimer = null;
                if (this._destroyed) return;
                this._recentTouch = false;
            }, 400);
            if (holdTriggered) return;
            this._callbacks.onToggleBubble();
        };
    }

    /** Mount the Pet into the active Markdown leaf or its phone toolbar. */
    mount(containerEl: HTMLElement): void {
        if (this._destroyed) return;
        if (this._rootEl) return; // already mounted

        const mountTarget = resolvePetMountTarget(containerEl);
        const mountEl = mountTarget.mountEl;
        this._containerEl = mountEl;

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
        if (mountTarget.mobileToolbar) {
            root.classList.add("pa-pagelet-pet--mobile-toolbar");
        }

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

        if (this._callbacks.onQuickCaptureOpen) {
            root.setAttribute("aria-keyshortcuts", "Shift+Enter");
        }

        // Event listeners
        root.addEventListener("click", this._handleClick);
        root.addEventListener("keydown", this._handleKeydown);
        root.addEventListener("mousedown", this._handleMouseDown);
        root.addEventListener("mouseup", this._handleMouseUp);
        root.addEventListener("mouseleave", this._handleMouseLeave);
        root.addEventListener("touchstart", this._handleTouchstart, { passive: true });
        root.addEventListener("touchend", this._handleTouchend, { passive: false });

        if (mountTarget.insertAfterEl) {
            mountEl.insertBefore(root, mountTarget.insertAfterEl.nextSibling);
        } else {
            mountEl.appendChild(root);
        }

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
        this._rootEl.removeEventListener("mousedown", this._handleMouseDown);
        this._rootEl.removeEventListener("mouseup", this._handleMouseUp);
        this._rootEl.removeEventListener("mouseleave", this._handleMouseLeave);
        this._rootEl.removeEventListener("touchstart", this._handleTouchstart);
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
        this.clearQuickCaptureHoldTimer();
        this._quickCaptureHoldTriggered = false;
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

    private clearQuickCaptureHoldTimer(): void {
        if (this._quickCaptureHoldTimer !== null) {
            clearPlatformTimeout(this._quickCaptureHoldTimer);
            this._quickCaptureHoldTimer = null;
        }
        this._rootEl?.removeAttribute("data-capture-hold");
    }

    private startQuickCaptureHold(): void {
        if (
            this._destroyed
            || !this._callbacks.onQuickCaptureOpen
        ) {
            return;
        }
        this.clearQuickCaptureHoldTimer();
        this._quickCaptureHoldTriggered = false;
        this._rootEl?.setAttribute("data-capture-hold", "true");
        this._quickCaptureHoldTimer = setPlatformTimeout(() => {
            this._quickCaptureHoldTimer = null;
            if (this._destroyed) return;
            this._quickCaptureHoldTriggered = true;
            this._rootEl?.removeAttribute("data-capture-hold");
            this.openQuickCapture();
        }, QUICK_CAPTURE_HOLD_MS);
    }

    private consumeQuickCaptureHold(): boolean {
        this.clearQuickCaptureHoldTimer();
        const triggered = this._quickCaptureHoldTriggered;
        this._quickCaptureHoldTriggered = false;
        return triggered;
    }

    private openQuickCapture(): void {
        if (this._destroyed) return;
        this._callbacks.onQuickCaptureOpen?.();
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

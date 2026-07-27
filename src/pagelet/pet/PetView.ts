/* Copyright 2023 edonyzpc */

/**
 * Pagelet Pet DOM lifecycle manager.
 *
 * Owns: wrapper div, SVG element, notification dot, event listeners.
 * Does NOT own: the state machine or analysis pipeline. Callers drive
 * state via `setState()`.
 */

import { Platform } from "obsidian";
import type {
    ActionRingCloseReason,
    PetCallbacks,
    PetCorner,
    PetRenderer,
    PetRendererOptions,
    PetState,
    PetTaskKind,
} from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import {
    clearPlatformTimeout,
    getOptionalPlatformDocument,
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

export function getPetActionRingLabels(locale: PageletLocale): {
    ariaLabel: string;
    capture: string;
    review: string;
    discover: string;
} {
    return {
        ariaLabel: pageletT("pagelet.pet.actionRing.ariaLabel", locale),
        capture: pageletT("pagelet.pet.actionRing.capture", locale),
        review: pageletT("pagelet.pet.actionRing.review", locale),
        discover: pageletT("pagelet.pet.actionRing.discover", locale),
    };
}

/** @deprecated Kept for callers that still consume the pre-B-121 label helper. */
export function getPetHoldMenuLabels(locale: PageletLocale): {
    capture: string;
    review: string;
    discover: string;
} {
    const { capture, review, discover } = getPetActionRingLabels(locale);
    return { capture, review, discover };
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

const ACTION_RING_HOLD_MS = 520;
const ACTION_RING_DISMISS_MS = 3000;
const ROOT_GESTURE_MOVE_THRESHOLD_PX = 12;
const ACTION_RING_VIEWPORT_GUTTER_PX = 8;
const ACTION_RING_ITEM_GAP_PX = 8;
let nextActionRingId = 1;

export interface ActionRingLayoutRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface ActionRingItemSize {
    width: number;
    height: number;
}

export interface ActionRingItemPosition {
    left: number;
    top: number;
}

export interface ActionRingSafeAreaInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * Limit viewport-relative Ring geometry to the visible Markdown surface.
 * Desktop Pet DOM lives inside that surface, whose overflow can clip children
 * even when they still fit inside the browser visual viewport.
 */
export function intersectActionRingViewport(
    viewport: ActionRingLayoutRect,
    constraint: ActionRingLayoutRect,
): ActionRingLayoutRect {
    const viewportRight = viewport.left + Math.max(0, viewport.width);
    const viewportBottom = viewport.top + Math.max(0, viewport.height);
    const constraintRight = constraint.left + Math.max(0, constraint.width);
    const constraintBottom = constraint.top + Math.max(0, constraint.height);
    const left = Math.max(viewport.left, constraint.left);
    const top = Math.max(viewport.top, constraint.top);
    const right = Math.max(left, Math.min(viewportRight, constraintRight));
    const bottom = Math.max(top, Math.min(viewportBottom, constraintBottom));
    return {
        left,
        top,
        width: right - left,
        height: bottom - top,
    };
}

const DESKTOP_ACTION_RING_OFFSETS: Record<
    PetCorner,
    readonly ActionRingItemPosition[]
> = {
    "bottom-right": [
        { left: -118, top: -30 },
        { left: -110, top: -86 },
        { left: -58, top: -122 },
    ],
    "bottom-left": [
        { left: 38, top: -30 },
        { left: 46, top: -86 },
        { left: -4, top: -122 },
    ],
    "top-right": [
        { left: -118, top: -14 },
        { left: -110, top: 42 },
        { left: -58, top: 78 },
    ],
    "top-left": [
        { left: 38, top: -14 },
        { left: 46, top: 42 },
        { left: -4, top: 78 },
    ],
};

/**
 * Resolve three positions inside the current visual viewport. The preferred
 * desktop result is an inward arc. Phone-toolbar actions form a horizontal row
 * beneath the Pet and degrade to a compact column only when their full labels
 * cannot fit without clipping or overlap.
 */
export function computeActionRingLayout(input: {
    viewport: ActionRingLayoutRect;
    anchor: ActionRingLayoutRect;
    items: readonly ActionRingItemSize[];
    corner: PetCorner;
    mobileToolbar: boolean;
    gutter?: number;
    safeAreaInsets?: Partial<ActionRingSafeAreaInsets>;
}): ActionRingItemPosition[] {
    const gutter = Math.max(0, input.gutter ?? ACTION_RING_VIEWPORT_GUTTER_PX);
    const safeAreaInsets = {
        top: Math.max(0, finiteDimension(input.safeAreaInsets?.top ?? 0, 0)),
        right: Math.max(0, finiteDimension(input.safeAreaInsets?.right ?? 0, 0)),
        bottom: Math.max(0, finiteDimension(input.safeAreaInsets?.bottom ?? 0, 0)),
        left: Math.max(0, finiteDimension(input.safeAreaInsets?.left ?? 0, 0)),
    };
    const viewportRight = input.viewport.left + input.viewport.width;
    const viewportBottom = input.viewport.top + input.viewport.height;
    const minLeft = input.viewport.left + gutter + safeAreaInsets.left;
    const minTop = input.viewport.top + gutter + safeAreaInsets.top;
    const maxRight = viewportRight - gutter - safeAreaInsets.right;
    const maxBottom = viewportBottom - gutter - safeAreaInsets.bottom;
    const anchorCenterX = input.anchor.left + input.anchor.width / 2;
    const anchorCenterY = input.anchor.top + input.anchor.height / 2;
    const sizes = input.items.map((item) => ({
        width: Math.max(44, finiteDimension(item.width, 44)),
        height: Math.max(44, finiteDimension(item.height, 44)),
    }));

    if (input.mobileToolbar) {
        const horizontal = buildMobileToolbarHorizontalActionRingLayout({
            sizes,
            anchor: input.anchor,
            minLeft,
            minTop,
            maxRight,
            maxBottom,
            gutter,
        });
        if (!actionRingPositionsOverlap(horizontal, sizes)) return horizontal;

        return buildMobileToolbarVerticalActionRingFallback({
            sizes,
            anchor: input.anchor,
            minLeft,
            minTop,
            maxRight,
            maxBottom,
            gutter,
        });
    }

    const preferredOffsets = DESKTOP_ACTION_RING_OFFSETS[input.corner];
    const preferredOrigin = { left: anchorCenterX, top: anchorCenterY };
    const preferred = sizes.map((size, index) => {
        const offset = preferredOffsets[index] ?? { left: 0, top: 0 };
        return clampActionRingPosition({
            left: preferredOrigin.left + offset.left,
            top: preferredOrigin.top + offset.top,
        }, size, { minLeft, minTop, maxRight, maxBottom });
    });
    if (!actionRingPositionsOverlap(preferred, sizes)) return preferred;

    const horizontal = buildHorizontalActionRingFallback({
        sizes,
        anchor: input.anchor,
        viewport: input.viewport,
        minLeft,
        minTop,
        maxRight,
        maxBottom,
    });
    if (!actionRingPositionsOverlap(horizontal, sizes)) return horizontal;

    return buildVerticalActionRingFallback({
        sizes,
        anchor: input.anchor,
        viewport: input.viewport,
        minLeft,
        minTop,
        maxRight,
        maxBottom,
    });
}

function buildMobileToolbarHorizontalActionRingLayout(input: {
    sizes: readonly ActionRingItemSize[];
    anchor: ActionRingLayoutRect;
    minLeft: number;
    minTop: number;
    maxRight: number;
    maxBottom: number;
    gutter: number;
}): ActionRingItemPosition[] {
    const availableWidth = Math.max(0, input.maxRight - input.minLeft);
    const widthSum = input.sizes.reduce((sum, item) => sum + item.width, 0);
    const gap = input.sizes.length > 1
        ? clampNumber(
            (availableWidth - widthSum) / (input.sizes.length - 1),
            0,
            ACTION_RING_ITEM_GAP_PX,
        )
        : 0;
    const totalWidth = widthSum + gap * Math.max(0, input.sizes.length - 1);
    let cursor = clampNumber(
        input.anchor.left,
        input.minLeft,
        Math.max(input.minLeft, input.maxRight - totalWidth),
    );
    const maxHeight = Math.max(44, ...input.sizes.map((item) => item.height));
    const top = clampNumber(
        input.anchor.top + input.anchor.height + input.gutter,
        input.minTop,
        Math.max(input.minTop, input.maxBottom - maxHeight),
    );
    return input.sizes.map((size) => {
        const position = clampActionRingPosition(
            { left: cursor, top },
            size,
            input,
        );
        cursor += size.width + gap;
        return position;
    });
}

function buildMobileToolbarVerticalActionRingFallback(input: {
    sizes: readonly ActionRingItemSize[];
    anchor: ActionRingLayoutRect;
    minLeft: number;
    minTop: number;
    maxRight: number;
    maxBottom: number;
    gutter: number;
}): ActionRingItemPosition[] {
    const availableHeight = Math.max(0, input.maxBottom - input.minTop);
    const heightSum = input.sizes.reduce((sum, item) => sum + item.height, 0);
    const gap = input.sizes.length > 1
        ? clampNumber(
            (availableHeight - heightSum) / (input.sizes.length - 1),
            0,
            ACTION_RING_ITEM_GAP_PX,
        )
        : 0;
    const totalHeight = heightSum + gap * Math.max(0, input.sizes.length - 1);
    let cursor = clampNumber(
        input.anchor.top + input.anchor.height + input.gutter,
        input.minTop,
        Math.max(input.minTop, input.maxBottom - totalHeight),
    );
    const maxWidth = Math.max(44, ...input.sizes.map((item) => item.width));
    const left = clampNumber(
        input.anchor.left,
        input.minLeft,
        Math.max(input.minLeft, input.maxRight - maxWidth),
    );
    return input.sizes.map((size) => {
        const position = clampActionRingPosition(
            { left, top: cursor },
            size,
            input,
        );
        cursor += size.height + gap;
        return position;
    });
}

function buildHorizontalActionRingFallback(input: {
    sizes: readonly ActionRingItemSize[];
    anchor: ActionRingLayoutRect;
    viewport: ActionRingLayoutRect;
    minLeft: number;
    minTop: number;
    maxRight: number;
    maxBottom: number;
}): ActionRingItemPosition[] {
    const availableWidth = Math.max(0, input.maxRight - input.minLeft);
    const widths = input.sizes.map((item) => item.width);
    const widthSum = widths.reduce((sum, width) => sum + width, 0);
    const gap = input.sizes.length > 1
        ? clampNumber(
            (availableWidth - widthSum) / (input.sizes.length - 1),
            0,
            ACTION_RING_ITEM_GAP_PX,
        )
        : 0;
    const totalWidth = widthSum + gap * Math.max(0, input.sizes.length - 1);
    let cursor = clampNumber(
        input.anchor.left + input.anchor.width / 2 - totalWidth / 2,
        input.minLeft,
        Math.max(input.minLeft, input.maxRight - totalWidth),
    );
    const maxHeight = Math.max(44, ...input.sizes.map((item) => item.height));
    const placeAbove = input.anchor.top + input.anchor.height / 2
        >= input.viewport.top + input.viewport.height / 2;
    const top = clampNumber(
        placeAbove
            ? input.anchor.top - maxHeight - 12
            : input.anchor.top + input.anchor.height + 12,
        input.minTop,
        Math.max(input.minTop, input.maxBottom - maxHeight),
    );
    return input.sizes.map((size) => {
        const position = clampActionRingPosition(
            { left: cursor, top },
            size,
            input,
        );
        cursor += size.width + gap;
        return position;
    });
}

function buildVerticalActionRingFallback(input: {
    sizes: readonly ActionRingItemSize[];
    anchor: ActionRingLayoutRect;
    viewport: ActionRingLayoutRect;
    minLeft: number;
    minTop: number;
    maxRight: number;
    maxBottom: number;
}): ActionRingItemPosition[] {
    const availableHeight = Math.max(0, input.maxBottom - input.minTop);
    const heights = input.sizes.map((item) => item.height);
    const heightSum = heights.reduce((sum, height) => sum + height, 0);
    const gap = input.sizes.length > 1
        ? clampNumber(
            (availableHeight - heightSum) / (input.sizes.length - 1),
            0,
            ACTION_RING_ITEM_GAP_PX,
        )
        : 0;
    const totalHeight = heightSum + gap * Math.max(0, input.sizes.length - 1);
    let cursor = clampNumber(
        input.anchor.top + input.anchor.height / 2 - totalHeight / 2,
        input.minTop,
        Math.max(input.minTop, input.maxBottom - totalHeight),
    );
    const maxWidth = Math.max(44, ...input.sizes.map((item) => item.width));
    const placeLeft = input.anchor.left + input.anchor.width / 2
        >= input.viewport.left + input.viewport.width / 2;
    const left = clampNumber(
        placeLeft
            ? input.anchor.left - maxWidth - 12
            : input.anchor.left + input.anchor.width + 12,
        input.minLeft,
        Math.max(input.minLeft, input.maxRight - maxWidth),
    );
    return input.sizes.map((size) => {
        const position = clampActionRingPosition(
            { left, top: cursor },
            size,
            input,
        );
        cursor += size.height + gap;
        return position;
    });
}

function clampActionRingPosition(
    position: ActionRingItemPosition,
    size: ActionRingItemSize,
    bounds: {
        minLeft: number;
        minTop: number;
        maxRight: number;
        maxBottom: number;
    },
): ActionRingItemPosition {
    return {
        left: clampNumber(
            position.left,
            bounds.minLeft,
            Math.max(bounds.minLeft, bounds.maxRight - size.width),
        ),
        top: clampNumber(
            position.top,
            bounds.minTop,
            Math.max(bounds.minTop, bounds.maxBottom - size.height),
        ),
    };
}

function readActionRingSafeAreaInsets(doc: Document): ActionRingSafeAreaInsets {
    const win = doc.defaultView;
    if (!win || typeof win.getComputedStyle !== "function" || !doc.body) {
        return { top: 0, right: 0, bottom: 0, left: 0 };
    }
    const probe = doc.createElement("span");
    probe.className = "pa-pagelet-action-ring-safe-area-probe";
    doc.body.appendChild(probe);
    try {
        const style = win.getComputedStyle(probe);
        return {
            top: positiveCssPixels(style.paddingTop),
            right: positiveCssPixels(style.paddingRight),
            bottom: positiveCssPixels(style.paddingBottom),
            left: positiveCssPixels(style.paddingLeft),
        };
    } finally {
        probe.remove();
    }
}

function positiveCssPixels(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function actionRingPositionsOverlap(
    positions: readonly ActionRingItemPosition[],
    sizes: readonly ActionRingItemSize[],
): boolean {
    for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
        const leftPosition = positions[leftIndex];
        const leftSize = sizes[leftIndex];
        if (!leftPosition || !leftSize) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
            const rightPosition = positions[rightIndex];
            const rightSize = sizes[rightIndex];
            if (!rightPosition || !rightSize) continue;
            const separated = leftPosition.left + leftSize.width + 2 <= rightPosition.left
                || rightPosition.left + rightSize.width + 2 <= leftPosition.left
                || leftPosition.top + leftSize.height + 2 <= rightPosition.top
                || rightPosition.top + rightSize.height + 2 <= leftPosition.top;
            if (!separated) return true;
        }
    }
    return false;
}

function finiteDimension(value: number, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

type RootGesture =
    | {
        source: "pointer";
        pointerId: number;
        startX: number;
        startY: number;
        valid: boolean;
        openedActionRing: boolean;
    }
    | {
        source: "touch";
        touchIdentifier: number | null;
        startX: number;
        startY: number;
        valid: boolean;
        openedActionRing: boolean;
    };

export class PetView implements PetRenderer {
    private _state: PetState;
    private _taskKind: PetTaskKind;
    private _corner: PetCorner;
    private readonly _callbacks: PetCallbacks;
    private readonly _stateMachine: PetStateMachine;

    private _rootEl: HTMLDivElement | null = null;
    private _triggerEl: HTMLButtonElement | null = null;
    private _svgWrapEl: HTMLElement | null = null;
    private _svgEl: SVGElement | null = null;
    private _containerEl: HTMLElement | null = null;
    private _destroyed = false;
    private _recentTouch = false;
    private _quickCaptureHoldTriggered = false;
    private _rootGesture: RootGesture | null = null;
    private _rootGestureDocumentCleanup: (() => void) | null = null;
    private _suppressNextRootClick = false;
    private _touchSuppressTimer: PlatformTimeoutHandle | null = null;
    private _errorTimer: PlatformTimeoutHandle | null = null;
    private _quickCaptureHoldTimer: PlatformTimeoutHandle | null = null;
    private readonly _actionRingId = `pa-pagelet-action-ring-${nextActionRingId++}`;
    private _actionRingOpening = false;
    private _actionRingEl: HTMLElement | null = null;
    private _actionRingDismissTimer: PlatformTimeoutHandle | null = null;
    private _actionRingFocusRestoreTimer: PlatformTimeoutHandle | null = null;
    private _actionRingOutsideListener: ((e: Event) => void) | null = null;
    private _actionRingTouchCleanup: (() => void) | null = null;
    private _actionRingLayoutCleanup: (() => void) | null = null;
    private _actionRingActivityCleanup: (() => void) | null = null;
    private _themeObserver: MutationObserver | null = null;
    private readonly _getLocale: () => PageletLocale;

    // Bound handlers for clean removal
    private readonly _handleClick: (e: MouseEvent) => void;
    private readonly _handleKeydown: (e: KeyboardEvent) => void;
    private readonly _handlePointerDown: (e: PointerEvent) => void;
    private readonly _handlePointerMove: (e: PointerEvent) => void;
    private readonly _handlePointerUp: (e: PointerEvent) => void;
    private readonly _handlePointerCancel: (e: PointerEvent) => void;
    private readonly _handlePointerLeave: (e: PointerEvent) => void;
    private readonly _handleTouchstart: (e: TouchEvent) => void;
    private readonly _handleTouchmove: (e: TouchEvent) => void;
    private readonly _handleTouchend: (e: TouchEvent) => void;
    private readonly _handleTouchcancel: (e: TouchEvent) => void;

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

        this._handleClick = (e) => {
            if (this.isActionRingEvent(e)) return;
            if (this._recentTouch) return;
            if (this._suppressNextRootClick) {
                this._suppressNextRootClick = false;
                this._quickCaptureHoldTriggered = false;
                return;
            }
            if (this.consumeQuickCaptureHold()) return;
            this.handleShortActivation();
        };
        this._handleKeydown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && this.actionRingOpen) {
                e.preventDefault();
                e.stopPropagation();
                this.dismissActionRingFromEscape();
                return;
            }
            if (this.isActionRingEvent(e)) return;
            if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu" || e.key === "Apps") {
                e.preventDefault();
                this.openActionRing();
                return;
            }
            if (e.shiftKey && e.key === "Enter") {
                e.preventDefault();
                if (this.actionRingOpen) {
                    this.closeActionRing(false, "action");
                }
                this.openQuickCapture();
                return;
            }
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.handleShortActivation();
            }
        };
        this._handlePointerDown = (e: PointerEvent) => {
            if (this.isActionRingEvent(e) || e.pointerType === "touch") return;
            if (e.button !== 0 || e.isPrimary === false) {
                if (this._rootGesture) this.cancelRootGestureAndRollbackOpenedRing();
                return;
            }
            if (this._rootGesture) {
                this.cancelRootGestureAndRollbackOpenedRing();
                return;
            }
            this.startPointerHold(e);
        };
        this._handlePointerMove = (e: PointerEvent) => {
            const gesture = this._rootGesture;
            if (!gesture || gesture.source !== "pointer") return;
            if (
                e.pointerId !== gesture.pointerId
                || e.isPrimary === false
                || !this.isWithinRootMoveThreshold(gesture, e.clientX, e.clientY)
            ) {
                this.cancelRootGestureAndRollbackOpenedRing();
            }
        };
        this._handlePointerUp = (e: PointerEvent) => {
            const gesture = this._rootGesture;
            if (!gesture || gesture.source !== "pointer") return;
            if (
                !gesture.valid
                || e.pointerId !== gesture.pointerId
                || !this.isWithinRootMoveThreshold(gesture, e.clientX, e.clientY)
            ) {
                this.cancelRootGestureAndRollbackOpenedRing();
                this._rootGesture = null;
                return;
            }
            this.finishPointerGesture();
        };
        this._handlePointerCancel = (e: PointerEvent) => {
            const gesture = this._rootGesture;
            if (!gesture || gesture.source !== "pointer" || e.pointerId !== gesture.pointerId) return;
            this.cancelRootGestureAndRollbackOpenedRing();
            this._rootGesture = null;
        };
        this._handlePointerLeave = (e: PointerEvent) => {
            const gesture = this._rootGesture;
            if (!gesture || gesture.source !== "pointer" || e.pointerId !== gesture.pointerId) return;
            this.cancelRootGestureAndRollbackOpenedRing();
            this._rootGesture = null;
        };
        this._handleTouchstart = (e: TouchEvent) => {
            if (this.isActionRingEvent(e)) return;
            if (this._rootGesture || e.touches.length !== 1) {
                this.cancelRootGestureAndRollbackOpenedRing();
                return;
            }
            this.startTouchHold(e.touches[0]);
        };
        this._handleTouchmove = (e: TouchEvent) => {
            if (this.isActionRingEvent(e)) return;
            const gesture = this._rootGesture;
            if (!gesture || gesture.source !== "touch") return;
            if (e.touches.length !== 1) {
                this.cancelRootGestureAndRollbackOpenedRing();
                return;
            }
            const touch = e.touches[0];
            if (
                !this.isMatchingTouch(gesture, touch)
                || !this.isWithinRootMoveThreshold(gesture, touch.clientX, touch.clientY)
            ) {
                this.cancelRootGestureAndRollbackOpenedRing();
            }
        };
        this._handleTouchend = (e: TouchEvent) => {
            if (this.isActionRingEvent(e)) return;
            e.preventDefault();
            this.suppressClicksAfterTouch();
            const gesture = this._rootGesture;
            if (!gesture || gesture.source !== "touch") return;
            const changedTouch = Array.from(e.changedTouches).find((touch) =>
                this.isMatchingTouch(gesture, touch),
            );
            const valid = gesture.valid
                && e.touches.length === 0
                && e.changedTouches.length === 1
                && changedTouch !== undefined
                && this.isWithinRootMoveThreshold(
                    gesture,
                    changedTouch.clientX,
                    changedTouch.clientY,
                );
            if (!valid) {
                this.cancelRootGestureAndRollbackOpenedRing();
                this._rootGesture = null;
                return;
            }
            const holdTriggered = this.consumeQuickCaptureHold();
            this.clearRootGestureDocumentGuard();
            this._rootGesture = null;
            if (holdTriggered) return;
            this.handleShortActivation();
        };
        this._handleTouchcancel = (e: TouchEvent) => {
            if (this.isActionRingEvent(e)) return;
            this.cancelRootGestureAndRollbackOpenedRing();
            this._rootGesture = null;
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
        if (mountTarget.mobileToolbar) {
            root.classList.add("pa-pagelet-pet--mobile-toolbar");
        }

        const trigger = createHtmlElement("button");
        trigger.className = "pa-pagelet-pet-wrapper pa-pagelet-pet-trigger";
        trigger.setAttribute("type", "button");
        trigger.setAttribute(
            "aria-label",
            getPetAriaLabel(this._getLocale(), this._state, this._taskKind),
        );
        trigger.setAttribute("aria-live", "polite");
        trigger.setAttribute("aria-controls", this._actionRingId);
        trigger.setAttribute("aria-expanded", "false");

        const notification = createHtmlElement("span");
        notification.className = "pa-pagelet-pet-notification";

        const svgWrap = createHtmlElement("span");
        svgWrap.className = "pa-pagelet-pet-svg-wrap";

        const svgEl = createPetSvgElement(this._state, this._taskKind);

        svgWrap.appendChild(svgEl);
        trigger.appendChild(notification);
        trigger.appendChild(svgWrap);
        root.appendChild(trigger);

        trigger.setAttribute(
            "aria-keyshortcuts",
            this._callbacks.onQuickCaptureOpen
                ? "Shift+Enter Shift+F10 ContextMenu"
                : "Shift+F10 ContextMenu",
        );

        // Event listeners
        root.addEventListener("click", this._handleClick);
        root.addEventListener("keydown", this._handleKeydown);
        root.addEventListener("pointerdown", this._handlePointerDown);
        root.addEventListener("pointermove", this._handlePointerMove);
        root.addEventListener("pointerup", this._handlePointerUp);
        root.addEventListener("pointercancel", this._handlePointerCancel);
        root.addEventListener("pointerleave", this._handlePointerLeave);
        root.addEventListener("touchstart", this._handleTouchstart, { passive: true });
        root.addEventListener("touchmove", this._handleTouchmove, { passive: true });
        root.addEventListener("touchend", this._handleTouchend, { passive: false });
        root.addEventListener("touchcancel", this._handleTouchcancel);

        if (mountTarget.insertAfterEl) {
            mountEl.insertBefore(root, mountTarget.insertAfterEl.nextSibling);
        } else {
            mountEl.appendChild(root);
        }

        this._rootEl = root;
        this._triggerEl = trigger;
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
        this.clearTouchSuppression();
        this.cancelRootGesture();
        this._rootGesture = null;
        this.closeActionRing(false, "passive");
        this._quickCaptureHoldTriggered = false;
        this._suppressNextRootClick = false;
        this._recentTouch = false;

        this._themeObserver?.disconnect();
        this._themeObserver = null;

        if (!this._rootEl) return;

        this._rootEl.removeEventListener("click", this._handleClick);
        this._rootEl.removeEventListener("keydown", this._handleKeydown);
        this._rootEl.removeEventListener("pointerdown", this._handlePointerDown);
        this._rootEl.removeEventListener("pointermove", this._handlePointerMove);
        this._rootEl.removeEventListener("pointerup", this._handlePointerUp);
        this._rootEl.removeEventListener("pointercancel", this._handlePointerCancel);
        this._rootEl.removeEventListener("pointerleave", this._handlePointerLeave);
        this._rootEl.removeEventListener("touchstart", this._handleTouchstart);
        this._rootEl.removeEventListener("touchmove", this._handleTouchmove);
        this._rootEl.removeEventListener("touchend", this._handleTouchend);
        this._rootEl.removeEventListener("touchcancel", this._handleTouchcancel);
        this._rootEl.remove();
        this._rootEl = null;
        this._triggerEl = null;
        this._svgWrapEl = null;
        this._svgEl = null;
        this._containerEl = null;
    }

    get rootEl(): HTMLElement | null {
        // External surfaces use this as both geometry anchor and focus-return
        // target; expose the native trigger, not the positioning container.
        return this.interactionElement();
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
            this.interactionElement()?.setAttribute(
                "aria-label",
                getPetAriaLabel(this._getLocale(), this._state, this._taskKind),
            );
            this.applyThemeColors();
        }
    }

    /** Set corner position. */
    setCorner(corner: PetCorner): void {
        if (this._destroyed) return;
        this._corner = corner;
        this._rootEl?.setAttribute("data-corner", corner);
        if (this._actionRingEl) {
            this._actionRingEl.setAttribute("data-corner", corner);
            this.installActionRingLayout(this._actionRingEl);
        }
    }

    get corner(): PetCorner {
        return this._corner;
    }

    get actionRingOpen(): boolean {
        return this._actionRingOpening || this._actionRingEl !== null;
    }

    /** Close the Ring for Escape and restore Pet focus after host key handling. */
    dismissActionRingFromEscape(): void {
        if (!this.actionRingOpen) return;
        // Obsidian may move focus after handling Escape. Restore Pet after the
        // key event completes so its fallback cannot win.
        this.closeActionRing(false, "passive");
        this.scheduleActionRingFocusRestore();
    }

    /** Open the three-action Ring. Re-opening only refreshes its inactivity timer. */
    openActionRing(): void {
        if (this._destroyed || !this._rootEl) return;
        this.clearActionRingFocusRestoreTimer();
        if (this.actionRingOpen) {
            this.refreshActionRingDismissTimer();
            return;
        }

        this._actionRingOpening = true;
        this.interactionElement()?.setAttribute("aria-expanded", "true");
        this._callbacks.onActionRingWillOpen?.();
        if (this._destroyed || !this._rootEl || !this._actionRingOpening) return;

        const ring = this.createActionRing();
        this._rootEl.appendChild(ring);
        this._actionRingEl = ring;
        this._actionRingOpening = false;
        this.installActionRingLayout(ring);
        this.installActionRingActivityListeners(ring);
        this.installActionRingOutsideListener(ring);
        this.refreshActionRingDismissTimer();
        ring.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    }

    /** Close the Ring, optionally returning focus to Pet. */
    closeActionRing(
        restoreFocus = true,
        reason: ActionRingCloseReason = "passive",
    ): void {
        this.clearActionRingFocusRestoreTimer();
        if (!this.actionRingOpen) return;
        this._actionRingOpening = false;
        this._actionRingTouchCleanup?.();
        this._actionRingLayoutCleanup?.();
        this._actionRingActivityCleanup?.();
        this.clearActionRingDismissTimer();
        if (this._actionRingOutsideListener) {
            getPlatformDocument().removeEventListener(
                "pointerdown",
                this._actionRingOutsideListener,
                true,
            );
            this._actionRingOutsideListener = null;
        }
        this._actionRingEl?.remove();
        this._actionRingEl = null;
        this.interactionElement()?.setAttribute("aria-expanded", "false");
        if (restoreFocus && reason === "passive") {
            this.interactionElement()?.focus();
        }
        this._callbacks.onActionRingClosed?.(reason);
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
        this.cancelRootGesture();
        this._rootGesture = null;
        this.closeActionRing(false, "passive");
        this._quickCaptureHoldTriggered = false;
        this._suppressNextRootClick = false;
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
        this.interactionElement()?.setAttribute(
            "aria-label",
            getPetAriaLabel(this._getLocale(), this._state, this._taskKind),
        );
        this.applyThemeColors();
    }

    private clearTouchSuppression(): void {
        if (this._touchSuppressTimer !== null) {
            clearPlatformTimeout(this._touchSuppressTimer);
            this._touchSuppressTimer = null;
        }
    }

    private suppressClicksAfterTouch(): void {
        this._recentTouch = true;
        this.clearTouchSuppression();
        this._touchSuppressTimer = setPlatformTimeout(() => {
            this._touchSuppressTimer = null;
            if (this._destroyed) return;
            this._recentTouch = false;
        }, 400);
    }

    private clearQuickCaptureHoldTimer(): void {
        if (this._quickCaptureHoldTimer !== null) {
            clearPlatformTimeout(this._quickCaptureHoldTimer);
            this._quickCaptureHoldTimer = null;
        }
        this._rootEl?.removeAttribute("data-capture-hold");
    }

    private handleShortActivation(): void {
        if (this.actionRingOpen) {
            this.closeActionRing(true, "passive");
            return;
        }
        this._callbacks.onToggleBubble();
    }

    private interactionElement(): HTMLElement | null {
        return this._triggerEl ?? this._rootEl;
    }

    private isWithinRootMoveThreshold(
        gesture: Pick<RootGesture, "startX" | "startY">,
        clientX: number,
        clientY: number,
    ): boolean {
        const dx = clientX - gesture.startX;
        const dy = clientY - gesture.startY;
        return dx * dx + dy * dy <= ROOT_GESTURE_MOVE_THRESHOLD_PX ** 2;
    }

    private isMatchingTouch(
        gesture: Extract<RootGesture, { source: "touch" }>,
        touch: Touch,
    ): boolean {
        return gesture.touchIdentifier === null
            || touch.identifier === undefined
            || touch.identifier === gesture.touchIdentifier;
    }

    private installRootGestureDocumentGuard(): void {
        this.clearRootGestureDocumentGuard();
        const doc = this.interactionElement()?.ownerDocument
            ?? getOptionalPlatformDocument();
        // Legacy/test seams can start a hold before mounting. A mounted Pet
        // always has an ownerDocument, but the unmounted seam must fail safe
        // instead of throwing.
        if (!doc) return;
        const handlePointerDown = (e: PointerEvent) => {
            const gesture = this._rootGesture;
            if (!gesture) return;
            if (gesture.source !== "pointer" || e.pointerId !== gesture.pointerId) {
                this.cancelRootGestureAndRollbackOpenedRing();
            }
        };
        const handleTouchStart = (e: TouchEvent) => {
            const gesture = this._rootGesture;
            if (!gesture) return;
            if (
                gesture.source !== "touch"
                || e.touches.length !== 1
                || !this.isMatchingTouch(gesture, e.touches[0])
            ) {
                this.cancelRootGestureAndRollbackOpenedRing();
            }
        };
        doc.addEventListener("pointerdown", handlePointerDown, true);
        doc.addEventListener("touchstart", handleTouchStart, true);
        this._rootGestureDocumentCleanup = () => {
            doc.removeEventListener("pointerdown", handlePointerDown, true);
            doc.removeEventListener("touchstart", handleTouchStart, true);
            this._rootGestureDocumentCleanup = null;
        };
    }

    private clearRootGestureDocumentGuard(): void {
        this._rootGestureDocumentCleanup?.();
    }

    private startRootHold(gesture: RootGesture): void {
        if (this._destroyed) return;
        this.clearQuickCaptureHoldTimer();
        this._rootGesture = gesture;
        this.installRootGestureDocumentGuard();
        this._quickCaptureHoldTriggered = false;
        this._suppressNextRootClick = false;
        this._rootEl?.setAttribute("data-capture-hold", "true");
        this._quickCaptureHoldTimer = setPlatformTimeout(() => {
            this._quickCaptureHoldTimer = null;
            if (
                this._destroyed
                || !this._rootGesture
                || !this._rootGesture.valid
            ) {
                return;
            }
            this._quickCaptureHoldTriggered = true;
            this._rootEl?.removeAttribute("data-capture-hold");
            const gesture = this._rootGesture;
            const ringWasAlreadyOpen = this.actionRingOpen;
            this.openActionRing();
            if (
                gesture
                && this._rootGesture === gesture
                && !ringWasAlreadyOpen
                && this.actionRingOpen
            ) {
                gesture.openedActionRing = true;
            }
        }, ACTION_RING_HOLD_MS);
    }

    private startPointerHold(e: PointerEvent): void {
        this.startRootHold({
            source: "pointer",
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            valid: true,
            openedActionRing: false,
        });
    }

    private startTouchHold(touch: Touch): void {
        this.startRootHold({
            source: "touch",
            touchIdentifier: touch.identifier ?? null,
            startX: touch.clientX,
            startY: touch.clientY,
            valid: true,
            openedActionRing: false,
        });
    }

    /** Legacy private seam retained for focused tests; real input uses pointer/touch metadata. */
    private startQuickCaptureHold(): void {
        this.startRootHold({
            source: "pointer",
            pointerId: -1,
            startX: 0,
            startY: 0,
            valid: true,
            openedActionRing: false,
        });
    }

    private finishPointerGesture(): void {
        this.clearQuickCaptureHoldTimer();
        this.clearRootGestureDocumentGuard();
        const holdTriggered = this._quickCaptureHoldTriggered;
        this._quickCaptureHoldTriggered = false;
        this._rootGesture = null;
        if (holdTriggered) this._suppressNextRootClick = true;
    }

    private cancelRootGesture(): void {
        if (this._rootGesture) {
            this._rootGesture.valid = false;
            this._suppressNextRootClick = true;
        }
        this.clearRootGestureDocumentGuard();
        this.clearQuickCaptureHoldTimer();
        this._quickCaptureHoldTriggered = false;
    }

    private cancelRootGestureAndRollbackOpenedRing(): void {
        const ringOpenedByGesture = Boolean(
            this._rootGesture?.openedActionRing
            && this.actionRingOpen,
        );
        this.cancelRootGesture();
        if (!ringOpenedByGesture) return;
        this.closeActionRing(false, "passive");
        this.scheduleActionRingFocusRestore();
    }

    private isActionRingEvent(e?: Event): boolean {
        const target = e?.target as Node | null | undefined;
        return Boolean(this._actionRingEl && target && this._actionRingEl.contains(target));
    }

    private createActionRing(): HTMLElement {
        const doc = getPlatformDocument();
        const ring = doc.createElement("div");
        ring.id = this._actionRingId;
        ring.className = "pa-pagelet-action-ring";
        ring.setAttribute("data-corner", this._corner);
        ring.setAttribute(
            "data-mobile-toolbar",
            this.mobileToolbarMounted()
                ? "true"
                : "false",
        );
        ring.setAttribute("role", "group");
        const labels = getPetActionRingLabels(this._getLocale());
        ring.setAttribute("aria-label", labels.ariaLabel);

        type ActiveActionTouch = {
            target: HTMLButtonElement;
            valid: boolean;
            startX: number;
            startY: number;
        };
        let activeActionTouch: ActiveActionTouch | null = null;
        const isWithinTouchMoveThreshold = (gesture: ActiveActionTouch, touch: Touch): boolean => {
            const dx = touch.clientX - gesture.startX;
            const dy = touch.clientY - gesture.startY;
            return dx * dx + dy * dy <= ROOT_GESTURE_MOVE_THRESHOLD_PX ** 2;
        };
        const stopActionTouchTracking = () => {
            doc.removeEventListener("touchstart", handleDocumentTouchChange, true);
            doc.removeEventListener("touchmove", handleDocumentTouchChange, true);
            doc.removeEventListener("touchend", handleDocumentTouchEnd, true);
            doc.removeEventListener("touchcancel", handleDocumentTouchCancel, true);
            activeActionTouch = null;
            if (this._actionRingTouchCleanup === stopActionTouchTracking) {
                this._actionRingTouchCleanup = null;
            }
        };
        const handleDocumentTouchChange = (e: TouchEvent) => {
            if (!activeActionTouch) return;
            if (
                e.touches.length !== 1
                || !isWithinTouchMoveThreshold(activeActionTouch, e.touches[0])
            ) {
                activeActionTouch.valid = false;
            }
        };
        const handleDocumentTouchEnd = (e: TouchEvent) => {
            if (!activeActionTouch) return;
            if (e.touches.length > 0 || e.changedTouches.length !== 1) {
                activeActionTouch.valid = false;
            }
            if (
                e.touches.length === 0
                && !activeActionTouch.target.contains(e.target as Node | null)
            ) {
                stopActionTouchTracking();
            }
        };
        const handleDocumentTouchCancel = () => {
            stopActionTouchTracking();
        };
        const startActionTouchTracking = (target: HTMLButtonElement, e: TouchEvent) => {
            if (activeActionTouch) {
                activeActionTouch.valid = false;
                return;
            }
            const touch = e.touches[0];
            activeActionTouch = {
                target,
                valid: e.touches.length === 1 && touch !== undefined,
                startX: touch?.clientX ?? 0,
                startY: touch?.clientY ?? 0,
            };
            doc.addEventListener("touchstart", handleDocumentTouchChange, true);
            doc.addEventListener("touchmove", handleDocumentTouchChange, true);
            doc.addEventListener("touchend", handleDocumentTouchEnd, true);
            doc.addEventListener("touchcancel", handleDocumentTouchCancel, true);
            this._actionRingTouchCleanup = stopActionTouchTracking;
        };

        const items: Array<{
            action: "capture" | "review" | "discover";
            label: string;
            callback: (() => void) | undefined;
        }> = [
            {
                action: "capture",
                label: labels.capture,
                callback: this._callbacks.onQuickCaptureOpen,
            },
            {
                action: "review",
                label: labels.review,
                callback: this._callbacks.onReviewCurrentNote,
            },
            {
                action: "discover",
                label: labels.discover,
                callback: this._callbacks.onDiscoverConnections,
            },
        ];

        for (const item of items) {
            const btn = doc.createElement("button");
            btn.className = "pa-pagelet-action-ring-item";
            btn.setAttribute("type", "button");
            btn.setAttribute("data-action", item.action);
            btn.textContent = item.label;
            const cb = item.callback;
            if (!cb) {
                btn.setAttribute("disabled", "");
                btn.setAttribute("aria-disabled", "true");
            }
            let actionExecuted = false;
            const executeAction = () => {
                if (actionExecuted || !cb) return;
                actionExecuted = true;
                this.closeActionRing(false, "action");
                cb();
            };
            btn.addEventListener("touchstart", (e) => {
                e.stopPropagation();
                startActionTouchTracking(btn, e);
            }, { passive: true });
            btn.addEventListener("touchmove", (e) => {
                e.stopPropagation();
                if (!activeActionTouch || activeActionTouch.target !== btn) return;
                if (
                    e.touches.length !== 1
                    || !isWithinTouchMoveThreshold(activeActionTouch, e.touches[0])
                ) {
                    activeActionTouch.valid = false;
                }
            }, { passive: true });
            btn.addEventListener("touchend", (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.suppressClicksAfterTouch();
                if (!activeActionTouch || activeActionTouch.target !== btn) return;
                const gesture = activeActionTouch;
                const gestureValid = gesture.valid;
                stopActionTouchTracking();
                if (!gestureValid || e.touches.length > 0 || e.changedTouches.length !== 1) return;
                const changedTouch = e.changedTouches[0];
                if (!isWithinTouchMoveThreshold(gesture, changedTouch)) return;
                executeAction();
            });
            btn.addEventListener("touchcancel", (e) => {
                e.stopPropagation();
                this.suppressClicksAfterTouch();
                stopActionTouchTracking();
            });
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (this._recentTouch) return;
                executeAction();
            });
            btn.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    executeAction();
                }
            });
            ring.appendChild(btn);
        }

        return ring;
    }

    private installActionRingLayout(ring: HTMLElement): void {
        this._actionRingLayoutCleanup?.();
        const root = this._rootEl;
        if (!root || typeof root.getBoundingClientRect !== "function") return;
        const doc = root.ownerDocument ?? getPlatformDocument();
        const win = doc.defaultView ?? getOptionalPlatformWindow();
        if (!win) return;
        const reposition = () => {
            if (this._actionRingEl !== ring || !ring.isConnected) return;
            const rootRect = root.getBoundingClientRect();
            const visualViewport = win.visualViewport;
            const visualViewportRect = {
                left: visualViewport?.offsetLeft ?? 0,
                top: visualViewport?.offsetTop ?? 0,
                width: visualViewport?.width
                    ?? win.innerWidth
                    ?? doc.documentElement.clientWidth,
                height: visualViewport?.height
                    ?? win.innerHeight
                    ?? doc.documentElement.clientHeight,
            };
            const buttons = Array.from(ring.children) as HTMLElement[];
            const mobileToolbar = this.mobileToolbarMounted();
            const containerRect = !mobileToolbar
                && typeof this._containerEl?.getBoundingClientRect === "function"
                ? this._containerEl.getBoundingClientRect()
                : null;
            const viewport = containerRect
                && containerRect.width > 0
                && containerRect.height > 0
                ? intersectActionRingViewport(visualViewportRect, {
                    left: containerRect.left,
                    top: containerRect.top,
                    width: containerRect.width,
                    height: containerRect.height,
                })
                : visualViewportRect;
            const safeAreaInsets = readActionRingSafeAreaInsets(doc);
            const positions = computeActionRingLayout({
                viewport,
                anchor: {
                    left: rootRect.left,
                    top: rootRect.top,
                    width: rootRect.width,
                    height: rootRect.height,
                },
                items: buttons.map((button) => {
                    const rect = typeof button.getBoundingClientRect === "function"
                        ? button.getBoundingClientRect()
                        : null;
                    return {
                        // offset* is layout geometry before the entry
                        // scale animation; transformed client rects can
                        // underestimate the final hit target.
                        width: button.offsetWidth > 0
                            ? button.offsetWidth
                            : rect?.width ?? 44,
                        height: button.offsetHeight > 0
                            ? button.offsetHeight
                            : rect?.height ?? 44,
                    };
                }),
                corner: this._corner,
                mobileToolbar,
                safeAreaInsets,
            });
            const originLeft = mobileToolbar
                ? rootRect.left
                : rootRect.left + rootRect.width / 2;
            const originTop = mobileToolbar
                ? rootRect.top + rootRect.height + ACTION_RING_VIEWPORT_GUTTER_PX
                : rootRect.top + rootRect.height / 2;
            buttons.forEach((button, index) => {
                const position = positions[index];
                if (!position || typeof button.style?.setProperty !== "function") return;
                button.style.setProperty(
                    "--pa-action-ring-x",
                    `${position.left - originLeft}px`,
                );
                button.style.setProperty(
                    "--pa-action-ring-y",
                    `${position.top - originTop}px`,
                );
            });
        };
        reposition();
        win.addEventListener("resize", reposition);
        win.addEventListener("orientationchange", reposition);
        win.visualViewport?.addEventListener("resize", reposition);
        win.visualViewport?.addEventListener("scroll", reposition);
        this._actionRingLayoutCleanup = () => {
            win.removeEventListener("resize", reposition);
            win.removeEventListener("orientationchange", reposition);
            win.visualViewport?.removeEventListener("resize", reposition);
            win.visualViewport?.removeEventListener("scroll", reposition);
            if (this._actionRingLayoutCleanup) this._actionRingLayoutCleanup = null;
        };
    }

    private mobileToolbarMounted(): boolean {
        const root = this._rootEl as (HTMLElement & { classList?: DOMTokenList }) | null;
        return Boolean(root?.classList?.contains("pa-pagelet-pet--mobile-toolbar"));
    }

    private installActionRingOutsideListener(ring: HTMLElement): void {
        const doc = getPlatformDocument();
        const dismissOnOutside = (e: Event) => {
            const target = e.target as Node | null;
            if (target && (ring.contains(target) || this._rootEl?.contains(target))) return;
            // Pointer default focus runs after this capture listener. Restore
            // Pet on the next task so the passive-close focus contract wins.
            this.closeActionRing(false, "passive");
            this.scheduleActionRingFocusRestore();
        };
        this._actionRingOutsideListener = dismissOnOutside;
        doc.addEventListener("pointerdown", dismissOnOutside, true);
    }

    private installActionRingActivityListeners(ring: HTMLElement): void {
        this._actionRingActivityCleanup?.();
        const refresh = () => this.refreshActionRingDismissTimer();
        const eventNames = ["focusin", "keydown", "pointerdown", "pointermove", "touchstart"] as const;
        for (const eventName of eventNames) {
            ring.addEventListener(eventName, refresh, { passive: true });
        }
        this._actionRingActivityCleanup = () => {
            for (const eventName of eventNames) {
                ring.removeEventListener(eventName, refresh);
            }
            if (this._actionRingActivityCleanup) this._actionRingActivityCleanup = null;
        };
    }

    private refreshActionRingDismissTimer(): void {
        this.clearActionRingDismissTimer();
        if (!this.actionRingOpen) return;
        this._actionRingDismissTimer = setPlatformTimeout(() => {
            this._actionRingDismissTimer = null;
            this.closeActionRing(true, "passive");
        }, ACTION_RING_DISMISS_MS);
    }

    private clearActionRingDismissTimer(): void {
        if (this._actionRingDismissTimer !== null) {
            clearPlatformTimeout(this._actionRingDismissTimer);
            this._actionRingDismissTimer = null;
        }
    }

    private scheduleActionRingFocusRestore(): void {
        this.clearActionRingFocusRestoreTimer();
        this._actionRingFocusRestoreTimer = setPlatformTimeout(() => {
            this._actionRingFocusRestoreTimer = null;
            if (this._destroyed || this.actionRingOpen) return;
            this.interactionElement()?.focus();
        }, 0);
    }

    private clearActionRingFocusRestoreTimer(): void {
        if (this._actionRingFocusRestoreTimer !== null) {
            clearPlatformTimeout(this._actionRingFocusRestoreTimer);
            this._actionRingFocusRestoreTimer = null;
        }
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

import { Platform, setIcon } from "obsidian";

import { getPluginUiLanguage, makePluginTranslator } from "../locales/plugin";
import {
    cancelPlatformAnimationFrame,
    clearPlatformTimeout,
    getOptionalPlatformDocument,
    getOptionalPlatformWindow,
    getPlatformDocument,
    requestPlatformAnimationFrame,
    setPlatformTimeout,
    type PlatformAnimationFrameHandle,
    type PlatformTimeoutHandle,
} from "../platform-dom";

const KEYBOARD_LAYOUT_RESIZE_THRESHOLD_PX = 80;

type KeyboardPluginEventName = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardWillHide' | 'keyboardDidHide';
type KeyboardWindowEventName = KeyboardPluginEventName | 'resize' | 'orientationchange';
type KeyboardClearanceSource = 'native' | 'none' | 'visualViewport';

interface KeyboardPluginInfo {
    keyboardHeight?: number;
}

interface KeyboardPluginListenerHandle {
    remove?: () => Promise<void> | void;
}

// Capacitor Keyboard plugin facade. We let the WebView/layout viewport handle mobile keyboard
// geometry where possible, and only use native height as a fallback measurement.
interface KeyboardPluginFacade {
    addListener?: (
        eventName: KeyboardPluginEventName,
        listenerFunc: (info: KeyboardPluginInfo) => void,
    ) => Promise<KeyboardPluginListenerHandle> | KeyboardPluginListenerHandle;
    setResizeMode?: (options: { mode: string }) => Promise<void> | void;
}

export class MobileInputAdapter {
    private keyboardVisualViewport: VisualViewport | null = null;
    private keyboardUpdateHandler: (() => void) | null = null;
    private keyboardUpdateFrame: PlatformAnimationFrameHandle | null = null;
    private keyboardWindowListeners: Array<{ type: KeyboardWindowEventName; listener: EventListener; target: Window }> = [];
    private keyboardPluginListenerHandles: KeyboardPluginListenerHandle[] = [];
    private keyboardLayoutBaselineHeight = 0;
    private nativeKeyboardHeight = 0;
    private nativeKeyboardVisible = false;
    private mobileTabBarHandle: HTMLElement | null = null;
    private mobileTabBarOptions: HTMLElement | null = null;
    private mobileTabBarOptionsHandler: (() => void) | null = null;
    private mobileTabBarDismissTimer: PlatformTimeoutHandle | null = null;

    constructor(
        private readonly containerEl: HTMLElement,
        private readonly log: (message: string, ...args: unknown[]) => void,
    ) {}

    setupMobileTabBarAutoHide(containerEl: HTMLElement) {
        this.teardownMobileTabBarAutoHide();
        if (!Platform.isMobile) return;
        const t = makePluginTranslator(getPluginUiLanguage());
        const tabContainer = containerEl.closest('.workspace-drawer-tab-container');
        if (!tabContainer) return;
        const tabOptions = tabContainer.querySelector<HTMLElement>('.workspace-drawer-tab-options');
        if (!tabOptions) return;
        this.mobileTabBarOptions = tabOptions;

        const handle = getPlatformDocument().createElement('div');
        handle.className = 'pa-tab-bar-handle';
        handle.setAttribute('aria-label', t("plugin.chat.mobile.showTabBar"));
        handle.setAttribute('aria-expanded', 'false');
        setIcon(handle, 'chevron-up');
        containerEl.appendChild(handle);
        this.mobileTabBarHandle = handle;

        const dismiss = () => {
            tabOptions.classList.remove('pa-tab-bar-visible');
            setIcon(handle, 'chevron-up');
            handle.setAttribute('aria-label', t("plugin.chat.mobile.showTabBar"));
            handle.setAttribute('aria-expanded', 'false');
        };
        const scheduleDismiss = () => {
            this.clearMobileTabBarDismissTimer();
            this.mobileTabBarDismissTimer = setPlatformTimeout(dismiss, 5000);
        };

        handle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tabOptions.classList.contains('pa-tab-bar-visible')) {
                this.clearMobileTabBarDismissTimer();
                dismiss();
            } else {
                tabOptions.classList.add('pa-tab-bar-visible');
                setIcon(handle, 'chevron-down');
                handle.setAttribute('aria-label', t("plugin.chat.mobile.hideTabBar"));
                handle.setAttribute('aria-expanded', 'true');
                scheduleDismiss();
            }
        });

        const tabOptionsHandler = () => {
            this.clearMobileTabBarDismissTimer();
            scheduleDismiss();
        };
        tabOptions.addEventListener('click', tabOptionsHandler);
        this.mobileTabBarOptionsHandler = tabOptionsHandler;
    }

    teardownMobileTabBarAutoHide() {
        this.clearMobileTabBarDismissTimer();
        if (this.mobileTabBarOptions && this.mobileTabBarOptionsHandler) {
            this.mobileTabBarOptions.removeEventListener('click', this.mobileTabBarOptionsHandler);
        }
        this.mobileTabBarOptionsHandler = null;
        this.mobileTabBarOptions?.classList.remove('pa-tab-bar-visible');
        this.mobileTabBarOptions = null;
        this.mobileTabBarHandle?.remove();
        this.mobileTabBarHandle = null;
    }

    private clearMobileTabBarDismissTimer() {
        if (this.mobileTabBarDismissTimer !== null) {
            clearPlatformTimeout(this.mobileTabBarDismissTimer);
            this.mobileTabBarDismissTimer = null;
        }
    }

    observeKeyboardClearance(containerEl: HTMLElement, inputEl: HTMLElement, onClearanceChange?: () => void) {
        this.disconnectKeyboardClearance();

        let previousClearance = -1;
        let previousAccessoryClearance = -1;
        let previousComposerHeight = -1;
        let previousSource: KeyboardClearanceSource = 'none';
        let previousKeyboardVisible = false;
        this.keyboardLayoutBaselineHeight = this.getLayoutViewportHeight();
        const applyClearance = (notify: boolean) => {
            const measurement = this.measureKeyboardClearance(containerEl, inputEl);
            const clearance = measurement.realClearance;
            if (
                clearance === previousClearance
                && measurement.accessoryClearance === previousAccessoryClearance
                && measurement.composerHeight === previousComposerHeight
                && measurement.source === previousSource
                && measurement.keyboardVisible === previousKeyboardVisible
            ) {
                return;
            }
            previousClearance = clearance;
            previousAccessoryClearance = measurement.accessoryClearance;
            previousComposerHeight = measurement.composerHeight;
            previousSource = measurement.source;
            previousKeyboardVisible = measurement.keyboardVisible;
            this.setKeyboardClearanceStyles(containerEl, clearance, measurement.keyboardVisible);
            this.syncKeyboardComposerOverlay(containerEl, clearance, measurement.accessoryClearance, measurement.composerHeight, measurement.source, measurement.keyboardVisible);
            if (notify) {
                onClearanceChange?.();
            }
        };
        const updateClearance = () => {
            this.keyboardUpdateFrame = null;
            applyClearance(true);
        };
        const scheduleUpdate = () => {
            if (this.keyboardUpdateFrame !== null) return;
            this.keyboardUpdateFrame = requestPlatformAnimationFrame(updateClearance);
        };

        this.keyboardUpdateHandler = scheduleUpdate;
        this.keyboardVisualViewport = this.getVisualViewport();
        applyClearance(false);

        this.keyboardVisualViewport?.addEventListener('resize', scheduleUpdate);
        this.keyboardVisualViewport?.addEventListener('scroll', scheduleUpdate);

        this.addWindowKeyboardListener('resize', scheduleUpdate);
        this.addWindowKeyboardListener('orientationchange', scheduleUpdate);
        this.observeNativeKeyboardEvents(scheduleUpdate);
    }

    disconnectKeyboardClearance() {
        if (this.keyboardUpdateFrame !== null) {
            cancelPlatformAnimationFrame(this.keyboardUpdateFrame);
        }
        this.keyboardUpdateFrame = null;

        if (this.keyboardUpdateHandler) {
            this.keyboardVisualViewport?.removeEventListener('resize', this.keyboardUpdateHandler);
            this.keyboardVisualViewport?.removeEventListener('scroll', this.keyboardUpdateHandler);
        }
        for (const { type, listener, target } of this.keyboardWindowListeners) {
            target.removeEventListener(type, listener);
        }
        this.keyboardWindowListeners = [];

        for (const handle of this.keyboardPluginListenerHandles.splice(0)) {
            this.safeInvokeKeyboardPlugin(
                () => handle.remove?.(),
                'Could not remove native keyboard listener',
            );
        }

        this.keyboardVisualViewport = null;
        this.keyboardUpdateHandler = null;
        this.nativeKeyboardHeight = 0;
        this.nativeKeyboardVisible = false;
        this.keyboardLayoutBaselineHeight = 0;
        this.setKeyboardClearanceStyles(this.containerEl, 0, false);
        this.clearKeyboardComposerOverlay(this.containerEl);
    }

    getVisualViewport(): VisualViewport | null {
        return getOptionalPlatformWindow()?.visualViewport ?? null;
    }

    measureKeyboardClearance(containerEl: HTMLElement, inputEl: HTMLElement): {
        realClearance: number;
        accessoryClearance: number;
        composerHeight: number;
        source: KeyboardClearanceSource;
        keyboardVisible: boolean;
    } {
        if (!containerEl.getBoundingClientRect) {
            return {
                realClearance: 0,
                accessoryClearance: 0,
                composerHeight: 0,
                source: 'none',
                keyboardVisible: false,
            };
        }

        const viewRect = containerEl.getBoundingClientRect();
        const visualViewport = this.getVisualViewport();
        const viewportOverlap = this.calculateVisualViewportKeyboardOverlap(viewRect, visualViewport);
        const nativeOverlap = this.calculateKeyboardHeightOverlap(viewRect, this.nativeKeyboardHeight);
        const realClearance = Math.max(viewportOverlap, nativeOverlap);
        const composerHeight = this.measureComposerHeight(inputEl);
        const nativeFallbackPreferred = this.nativeKeyboardVisible
            && nativeOverlap > 0
            && nativeOverlap >= viewportOverlap;
        const source = realClearance <= 0
            ? 'none'
            : nativeFallbackPreferred
                ? 'native'
                : viewportOverlap >= nativeOverlap
                    ? 'visualViewport'
                    : 'native';
        const keyboardVisible = realClearance > 0
            || this.nativeKeyboardVisible
            || this.isVisualViewportKeyboardLikelyVisible(visualViewport);
        const accessoryClearance = 0;
        if (!keyboardVisible) {
            this.refreshKeyboardLayoutBaselineHeight();
        }

        return {
            realClearance,
            accessoryClearance,
            composerHeight,
            source,
            keyboardVisible,
        };
    }

    measureComposerHeight(inputEl: HTMLElement): number {
        const composerRect = inputEl.getBoundingClientRect?.();
        return composerRect?.height && Number.isFinite(composerRect.height)
            ? Math.ceil(composerRect.height)
            : 0;
    }

    calculateVisualViewportKeyboardOverlap(viewRect: DOMRect, viewport: VisualViewport | null): number {
        if (!viewport) return 0;

        const viewportBottom = viewport.offsetTop + viewport.height;
        if (!Number.isFinite(viewportBottom) || viewportBottom <= 0) return 0;
        const overlap = viewRect.bottom - viewportBottom;
        if (overlap <= 1) return 0;
        return Math.ceil(Math.min(overlap, viewRect.height));
    }

    calculateKeyboardHeightOverlap(viewRect: DOMRect, keyboardHeight: number): number {
        if (keyboardHeight <= 0) return 0;

        const layoutHeight = this.getLayoutViewportHeight();
        if (
            layoutHeight > 0
            && this.keyboardLayoutBaselineHeight > 0
            && layoutHeight < this.keyboardLayoutBaselineHeight - KEYBOARD_LAYOUT_RESIZE_THRESHOLD_PX
        ) {
            const residualOverlap = viewRect.bottom - layoutHeight;
            if (residualOverlap <= 1) return 0;
            return Math.ceil(Math.min(residualOverlap, viewRect.height));
        }
        if (layoutHeight <= 0) return Math.ceil(Math.min(keyboardHeight, viewRect.height));

        const keyboardTop = layoutHeight - keyboardHeight;
        const overlap = viewRect.bottom - keyboardTop;
        if (overlap <= 1) return 0;
        return Math.ceil(Math.min(overlap, keyboardHeight, viewRect.height));
    }

    isVisualViewportKeyboardLikelyVisible(viewport: VisualViewport | null): boolean {
        if (!viewport) return false;
        const layoutHeight = this.getLayoutViewportHeight();
        const viewportBottom = viewport.offsetTop + viewport.height;
        if (!Number.isFinite(viewportBottom) || viewportBottom <= 0 || layoutHeight <= 0) return false;
        return viewportBottom < layoutHeight - 1;
    }

    refreshKeyboardLayoutBaselineHeight() {
        const layoutHeight = this.getLayoutViewportHeight();
        if (layoutHeight > 0) {
            this.keyboardLayoutBaselineHeight = layoutHeight;
        }
    }

    syncKeyboardComposerOverlay(
        containerEl: HTMLElement,
        clearance: number,
        accessoryClearance: number,
        composerHeight: number,
        source: KeyboardClearanceSource,
        keyboardVisible: boolean,
    ) {
        if (!keyboardVisible) {
            this.clearKeyboardComposerOverlay(containerEl);
            return;
        }

        containerEl.setCssProps({
            '--pa-chat-composer-height': `${composerHeight}px`,
            '--pa-chat-keyboard-accessory-clearance': `${accessoryClearance}px`,
        });
        containerEl.classList.add('is-keyboard-open');
        if (source === 'native' && clearance > 0) {
            containerEl.classList.add('is-keyboard-native-fallback');
        } else {
            containerEl.classList.remove('is-keyboard-native-fallback');
        }
    }

    clearKeyboardComposerOverlay(containerEl: HTMLElement) {
        containerEl.classList.remove('is-keyboard-open');
        containerEl.classList.remove('is-keyboard-native-fallback');
        containerEl.setCssProps({
            '--pa-chat-composer-height': '0px',
            '--pa-chat-keyboard-accessory-clearance': '0px',
        });
    }

    setKeyboardClearanceStyles(containerEl: HTMLElement, clearance: number, keyboardVisible: boolean) {
        // When JS has measured a real overlap (visualViewport or Capacitor keyboard event),
        // pin the explicit pixel value. A visible keyboard with no residual overlap gets an
        // explicit zero so the mobile spacer does not consume env(keyboard-inset-height).
        // Once the keyboard is closed, reset to the CSS env() fallback for the next show.
        if (clearance > 0) {
            containerEl.setCssProps({
                '--pa-chat-keyboard-clearance': `${clearance}px`,
                '--pa-chat-keyboard-offset': `-${clearance}px`,
            });
        } else if (keyboardVisible) {
            containerEl.setCssProps({
                '--pa-chat-keyboard-clearance': '0px',
                '--pa-chat-keyboard-offset': '0px',
            });
        } else {
            containerEl.setCssProps({
                '--pa-chat-keyboard-clearance': 'env(keyboard-inset-height, 0px)',
                '--pa-chat-keyboard-offset': 'calc(0px - env(keyboard-inset-height, 0px))',
            });
        }
    }

    getLayoutViewportHeight(): number {
        const win = getOptionalPlatformWindow();
        if (Number.isFinite(win?.innerHeight) && (win?.innerHeight ?? 0) > 0) {
            return win?.innerHeight ?? 0;
        }
        const doc = getOptionalPlatformDocument();
        return doc?.documentElement?.clientHeight
            ?? doc?.body?.clientHeight
            ?? 0;
    }

    observeNativeKeyboardEvents(scheduleUpdate: () => void) {
        const handleShow = (source: unknown) => {
            const keyboardHeight = this.readKeyboardHeight(source);
            this.nativeKeyboardVisible = true;
            if (keyboardHeight > 0) {
                this.nativeKeyboardHeight = keyboardHeight;
            }
            scheduleUpdate();
        };
        const handleHide = () => {
            this.nativeKeyboardVisible = false;
            this.nativeKeyboardHeight = 0;
            scheduleUpdate();
        };

        this.addWindowKeyboardListener('keyboardWillShow', handleShow);
        this.addWindowKeyboardListener('keyboardDidShow', handleShow);
        this.addWindowKeyboardListener('keyboardWillHide', handleHide);
        this.addWindowKeyboardListener('keyboardDidHide', handleHide);

        const keyboardPlugin = this.getNativeKeyboardPlugin();
        if (!keyboardPlugin?.addListener) return;
        // Let Capacitor resize the layout viewport; native events only provide fallback
        // keyboard height when the viewport has not reflected the keyboard yet.
        this.safeInvokeKeyboardPlugin(
            () => keyboardPlugin.setResizeMode?.({ mode: 'body' }),
            'Could not set native keyboard resize mode',
        );
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardWillShow', handleShow, scheduleUpdate);
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardDidShow', handleShow, scheduleUpdate);
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardWillHide', handleHide, scheduleUpdate);
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardDidHide', handleHide, scheduleUpdate);
    }

    private readKeyboardHeight(source: unknown): number {
        const value = this.readKeyboardHeightValue(source)
            ?? this.readKeyboardHeightValue((source as { detail?: unknown } | null)?.detail);
        const keyboardHeight = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(keyboardHeight) && keyboardHeight > 0 ? keyboardHeight : 0;
    }

    private readKeyboardHeightValue(source: unknown): unknown {
        if (!source || typeof source !== 'object') return undefined;
        return (source as { keyboardHeight?: unknown }).keyboardHeight;
    }

    addWindowKeyboardListener(type: KeyboardWindowEventName, listener: (source: unknown) => void) {
        const win = getOptionalPlatformWindow();
        if (typeof win?.addEventListener !== 'function') return;
        const eventListener: EventListener = (event) => listener(event);
        win.addEventListener(type, eventListener);
        this.keyboardWindowListeners.push({ type, listener: eventListener, target: win });
    }

    addKeyboardPluginListener(
        keyboardPlugin: KeyboardPluginFacade,
        type: KeyboardPluginEventName,
        listener: (source: unknown) => void,
        activeHandler: () => void,
    ) {
        try {
            const handleOrPromise = keyboardPlugin.addListener?.(type, listener);
            if (!handleOrPromise) return;
            void Promise.resolve(handleOrPromise).then((handle) => {
                if (!handle) return;
                if (this.keyboardUpdateHandler !== activeHandler) {
                    void handle.remove?.();
                    return;
                }
                this.keyboardPluginListenerHandles.push(handle);
            }).catch((error) => {
                this.log('Could not observe native keyboard events', error);
            });
        } catch (error) {
            this.log('Could not observe native keyboard events', error);
        }
    }

    getNativeKeyboardPlugin(): KeyboardPluginFacade | null {
        if (typeof window === 'undefined') return null;
        const candidate = window as typeof window & {
            Capacitor?: {
                Plugins?: {
                    Keyboard?: KeyboardPluginFacade;
                };
            };
        };
        return candidate.Capacitor?.Plugins?.Keyboard ?? null;
    }

    // Wraps a Capacitor plugin call that may return void OR a Promise. The naive
    // `try { void op(); } catch {}` pattern silently drops async rejections — this helper
    // also attaches a .catch() so unhandled rejections do not leak.
    safeInvokeKeyboardPlugin(op: () => unknown, errorMessage: string): void {
        try {
            const result = op();
            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch((error) => {
                    this.log(errorMessage, error);
                });
            }
        } catch (error) {
            this.log(errorMessage, error);
        }
    }
}

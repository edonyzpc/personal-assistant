/* Copyright 2023 edonyzpc */

export type PlatformTimeoutHandle = number;
export type PlatformIntervalHandle = number;
export type PlatformAnimationFrameHandle =
    | {
        kind: "animation-frame";
        scope: AnimationFrameScope;
        id: number;
    }
    | {
        kind: "timeout";
        handle: PlatformTimeoutHandle;
    };

type TimerScope = {
    setTimeout: (callback: TimerHandler, ms?: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    setInterval: (callback: TimerHandler, ms?: number) => unknown;
    clearInterval: (handle: unknown) => void;
};

type AnimationFrameScope = {
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame: (handle: number) => void;
};

type WindowTimerScope = Window & TimerScope;
type WindowAnimationFrameScope = Window & AnimationFrameScope;
type PlatformGlobalScope = Partial<TimerScope> & {
    document?: Document;
    localStorage?: Storage;
    crypto?: Crypto;
    indexedDB?: IDBFactory;
    IDBKeyRange?: typeof IDBKeyRange;
    navigator?: Navigator;
    performance?: Performance;
    customElements?: CustomElementRegistry;
    location?: Location;
    atob?: (payload: string) => string;
};

function getOptionalPlatformGlobalScope(): PlatformGlobalScope | undefined {
    if (typeof self !== "undefined") return self as unknown as PlatformGlobalScope;
    const win = getOptionalPlatformWindow();
    if (win) return win as unknown as PlatformGlobalScope;
    return undefined;
}

let cachedTimerScope: TimerScope | null = null;

function getRuntimeTimerScope(): TimerScope {
    if (cachedTimerScope) return cachedTimerScope;
    const candidates: Partial<TimerScope>[] = [];
    const win = getOptionalPlatformWindow();
    if (win) candidates.push(win as WindowTimerScope);
    const globalScope = getOptionalPlatformGlobalScope();
    if (globalScope) candidates.push(globalScope);

    const scope = candidates.find((candidate) =>
        typeof candidate.setTimeout === "function"
        && typeof candidate.clearTimeout === "function"
        && typeof candidate.setInterval === "function"
        && typeof candidate.clearInterval === "function"
    );
    if (!scope) throw new Error("Timer methods are unavailable.");
    cachedTimerScope = scope as TimerScope;
    return cachedTimerScope;
}

export function getOptionalPlatformWindow(): Window | undefined {
    if (typeof activeWindow !== "undefined") return activeWindow;
    if (typeof window !== "undefined") return window;
    return undefined;
}

function getAnimationFrameScope(): AnimationFrameScope | null {
    const candidates: Partial<AnimationFrameScope>[] = [];
    if (typeof activeWindow !== "undefined") candidates.push(activeWindow as WindowAnimationFrameScope);
    if (typeof window !== "undefined") candidates.push(window as WindowAnimationFrameScope);
    return candidates.find((candidate) =>
        typeof candidate.requestAnimationFrame === "function"
        && typeof candidate.cancelAnimationFrame === "function"
    ) as AnimationFrameScope | undefined ?? null;
}

export function getPlatformWindow(): Window {
    const win = getOptionalPlatformWindow();
    if (win) return win;
    throw new Error("Window is unavailable.");
}

export function getPlatformDocument(): Document {
    const doc = getOptionalPlatformDocument();
    if (doc) return doc;
    throw new Error("Document is unavailable.");
}

export function getOptionalPlatformDocument(): Document | undefined {
    if (typeof activeDocument !== "undefined") return activeDocument;
    return getOptionalPlatformGlobalScope()?.document;
}

export function getPlatformLocalStorage(): Storage | undefined {
    try {
        return getOptionalPlatformWindow()?.localStorage ?? getOptionalPlatformGlobalScope()?.localStorage;
    } catch {
        return undefined;
    }
}

export function getPlatformCrypto(): Crypto | undefined {
    return getOptionalPlatformWindow()?.crypto ?? getOptionalPlatformGlobalScope()?.crypto;
}

export function getPlatformIndexedDB(): IDBFactory | undefined {
    return getOptionalPlatformWindow()?.indexedDB ?? getOptionalPlatformGlobalScope()?.indexedDB;
}

export function getPlatformIDBKeyRange(): typeof IDBKeyRange | undefined {
    return getOptionalPlatformGlobalScope()?.IDBKeyRange;
}

export function getPlatformNavigatorStorage(): StorageManager | undefined {
    return getOptionalPlatformWindow()?.navigator?.storage ?? getOptionalPlatformGlobalScope()?.navigator?.storage;
}

export function getPlatformPerformance(): Performance | undefined {
    const win = getOptionalPlatformWindow();
    if (win?.performance) return win.performance;
    return getOptionalPlatformGlobalScope()?.performance;
}

export function getPlatformCustomElements(): CustomElementRegistry | undefined {
    return getOptionalPlatformWindow()?.customElements ?? getOptionalPlatformGlobalScope()?.customElements;
}

export function getPlatformLocation(): Location | undefined {
    return getOptionalPlatformWindow()?.location ?? getOptionalPlatformGlobalScope()?.location;
}

type SelectorTargetLike = {
    matches?: (selector: string) => boolean;
    closest?: (selector: string) => Element | null;
};

export function eventPathContainsSelector(event: Event, selector: string): boolean {
    const targets = typeof event.composedPath === "function" ? event.composedPath() : [];
    const fallbackTarget = (event as { target?: EventTarget | null }).target;
    if (fallbackTarget && !targets.includes(fallbackTarget)) {
        targets.unshift(fallbackTarget);
    }

    return targets.some((target) => {
        const element = target as SelectorTargetLike;
        try {
            if (typeof element.matches === "function" && element.matches(selector)) return true;
            return typeof element.closest === "function" && Boolean(element.closest(selector));
        } catch {
            return false;
        }
    });
}

export function decodePlatformBase64(payload: string): string {
    const win = getOptionalPlatformWindow();
    if (typeof win?.atob === "function") return win.atob(payload);
    const globalScope = getOptionalPlatformGlobalScope();
    if (typeof globalScope?.atob === "function") return globalScope.atob(payload);
    if (typeof Buffer !== "undefined") {
        return Buffer.from(payload, "base64").toString("binary");
    }
    throw new Error("Base64 decoder is unavailable.");
}

export function setPlatformTimeout(callback: TimerHandler, ms: number): PlatformTimeoutHandle {
    return getRuntimeTimerScope().setTimeout(callback, ms) as PlatformTimeoutHandle;
}

export function clearPlatformTimeout(timeoutId: number | PlatformTimeoutHandle): void {
    getRuntimeTimerScope().clearTimeout(timeoutId);
}

export function setPlatformInterval(callback: TimerHandler, ms: number): PlatformIntervalHandle {
    return getRuntimeTimerScope().setInterval(callback, ms) as PlatformIntervalHandle;
}

export function clearPlatformInterval(intervalId: number | PlatformIntervalHandle): void {
    getRuntimeTimerScope().clearInterval(intervalId);
}

export function requestPlatformAnimationFrame(callback: FrameRequestCallback): PlatformAnimationFrameHandle {
    const scope = getAnimationFrameScope();
    if (scope) {
        return {
            kind: "animation-frame",
            scope,
            id: scope.requestAnimationFrame(callback),
        };
    }
    return {
        kind: "timeout",
        handle: setPlatformTimeout(() => callback(Date.now()), 16),
    };
}

export function cancelPlatformAnimationFrame(frameId: PlatformAnimationFrameHandle): void {
    if (frameId.kind === "animation-frame") {
        frameId.scope.cancelAnimationFrame(frameId.id);
        return;
    }
    clearPlatformTimeout(frameId.handle);
}

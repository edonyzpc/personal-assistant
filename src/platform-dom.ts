/* Copyright 2023 edonyzpc */

export type PlatformTimeoutHandle = number | NodeJS.Timeout;
export type PlatformIntervalHandle = number | NodeJS.Timeout;
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
type PlatformGlobalScope = typeof globalThis & {
    localStorage?: Storage;
    crypto?: Crypto;
    indexedDB?: IDBFactory;
    navigator?: Navigator;
    performance?: Performance;
    customElements?: CustomElementRegistry;
    location?: Location;
    atob?: (payload: string) => string;
};

function getPlatformGlobalScope(): PlatformGlobalScope {
    return globalThis as PlatformGlobalScope;
}

let cachedTimerScope: TimerScope | null = null;

function getRuntimeTimerScope(): TimerScope {
    if (cachedTimerScope) return cachedTimerScope;
    const candidates: Partial<TimerScope>[] = [];
    if (typeof window !== "undefined") candidates.push(window as WindowTimerScope);
    candidates.push(getPlatformGlobalScope() as Partial<TimerScope>);

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
    if (typeof document !== "undefined") return document;
    return undefined;
}

export function getPlatformLocalStorage(): Storage | undefined {
    try {
        return getOptionalPlatformWindow()?.localStorage ?? getPlatformGlobalScope().localStorage;
    } catch {
        return undefined;
    }
}

export function getPlatformCrypto(): Crypto | undefined {
    return getOptionalPlatformWindow()?.crypto ?? getPlatformGlobalScope().crypto;
}

export function getPlatformIndexedDB(): IDBFactory | undefined {
    return getOptionalPlatformWindow()?.indexedDB ?? getPlatformGlobalScope().indexedDB;
}

export function getPlatformNavigatorStorage(): StorageManager | undefined {
    return getOptionalPlatformWindow()?.navigator?.storage ?? getPlatformGlobalScope().navigator?.storage;
}

export function getPlatformPerformance(): Performance | undefined {
    const win = getOptionalPlatformWindow();
    if (win?.performance) return win.performance;
    return getPlatformGlobalScope().performance;
}

export function getPlatformCustomElements(): CustomElementRegistry | undefined {
    return getOptionalPlatformWindow()?.customElements ?? getPlatformGlobalScope().customElements;
}

export function getPlatformLocation(): Location | undefined {
    return getOptionalPlatformWindow()?.location ?? getPlatformGlobalScope().location;
}

export function decodePlatformBase64(payload: string): string {
    const win = getOptionalPlatformWindow();
    const decoder = win?.atob ?? getPlatformGlobalScope().atob;
    if (typeof decoder !== "function") {
        if (typeof Buffer !== "undefined") {
            return Buffer.from(payload, "base64").toString("binary");
        }
        throw new Error("Base64 decoder is unavailable.");
    }
    return decoder.call(win ?? getPlatformGlobalScope(), payload);
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

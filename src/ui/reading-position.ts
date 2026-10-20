export interface ReadingSnapshot {
    anchorId?: string;
    offset: number;
    fallbackTop: number;
    disclosures?: string[];
}

export interface ReadingAnchor {
    id: string;
    element: HTMLElement;
}

export interface ReadingPositionOptions {
    scrollport: HTMLElement;
    getAnchors(): ReadingAnchor[];
    isVisible(): boolean;
    isReady(): boolean;
    onSnapshot(snapshot: ReadingSnapshot): void;
    onUserIntent(): void;
    restoreDisclosures?(ids: string[]): void;
}

interface Restoration {
    snapshot: ReadingSnapshot;
    started: boolean;
    attempts: number;
    previousTarget?: number;
}

// This budget only corrects an already-ready layout. History/Markdown readiness
// is supplied by the caller and never consumes a timeout or animation loop.
const MAX_LAYOUT_ATTEMPTS = 8;
const LAYOUT_SETTLE_TIMEOUT_MS = 400;
const POSITION_TOLERANCE = 1;

/** One owner of explicit position restoration for one real scrollport. */
export class ReadingPositionController {
    private readonly options: ReadingPositionOptions;
    private ownerWindow: Window | null;
    private restoration: Restoration | null = null;
    private frame: number | null = null;
    private timeout: number | null = null;
    private scheduleVersion = 0;
    private selfScrollTarget: number | null = null;
    private disposed = false;

    constructor(options: ReadingPositionOptions) {
        this.options = options;
        this.ownerWindow = options.scrollport.ownerDocument.defaultView;
        options.scrollport.addEventListener('scroll', this.onScroll, { passive: true });
        for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
            options.scrollport.addEventListener(event, this.onIntent, { passive: true, capture: true });
        }
    }

    isRestoring(): boolean {
        return this.restoration !== null;
    }

    capture(): ReadingSnapshot | null {
        if (this.disposed || this.restoration || !this.hasReadyLayout()) return null;
        const port = this.options.scrollport;
        const viewport = port.getBoundingClientRect();
        const visible = this.options.getAnchors().find(anchor => {
            if (!port.contains(anchor.element)) return false;
            const rect = anchor.element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0
                && rect.bottom > viewport.top && rect.top < viewport.bottom;
        });
        const snapshot: ReadingSnapshot = {
            offset: visible ? visible.element.getBoundingClientRect().top - viewport.top : 0,
            fallbackTop: this.clampTop(port.scrollTop),
            ...(visible ? { anchorId: visible.id } : {}),
        };
        this.options.onSnapshot(snapshot);
        return snapshot;
    }

    restore(snapshot: ReadingSnapshot): void {
        if (this.disposed) return;
        this.cancelRestore();
        this.restoration = {
            snapshot: { ...snapshot, ...(snapshot.disclosures ? { disclosures: [...snapshot.disclosures] } : {}) },
            started: false,
            attempts: 0,
        };
        this.options.restoreDisclosures?.([...(snapshot.disclosures ?? [])]);
        this.notifyLayout();
    }

    /** Call when host readiness, visibility or layout changes; pending work does not poll. */
    notifyLayout(): void {
        if (this.disposed || !this.restoration) return;
        if (!this.hasReadyLayout() || !this.ownerWindow) {
            this.stopScheduledWork();
            return;
        }
        const instance = this.restoration;
        if (instance.started) return;
        instance.started = true;
        const version = this.scheduleVersion;
        this.timeout = this.ownerWindow.setTimeout(() => {
            if (!this.isCurrent(instance, version)) return;
            this.timeout = null;
            if (!this.hasReadyLayout()) {
                this.stopScheduledWork();
                return;
            }
            this.finishAtAvailablePosition(instance);
        }, LAYOUT_SETTLE_TIMEOUT_MS);
        this.scheduleFrame(instance);
    }

    cancelRestore(): void {
        this.restoration = null;
        this.stopScheduledWork();
    }

    /** Adoption into another Obsidian window retains the pending snapshot. */
    rebindDocument(): void {
        if (this.disposed) return;
        const nextWindow = this.options.scrollport.ownerDocument.defaultView;
        if (nextWindow !== this.ownerWindow) {
            this.stopScheduledWork();
            this.ownerWindow = nextWindow;
        }
        this.notifyLayout();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelRestore();
        this.selfScrollTarget = null;
        this.options.scrollport.removeEventListener('scroll', this.onScroll);
        for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
            this.options.scrollport.removeEventListener(event, this.onIntent, true);
        }
    }

    private hasReadyLayout(): boolean {
        return this.hasVisibleLayout() && this.options.isReady();
    }

    private hasVisibleLayout(): boolean {
        const port = this.options.scrollport;
        if (!port.isConnected || !this.options.isVisible()) return false;
        const rect = port.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && port.clientHeight > 0;
    }

    private clampTop(top: number): number {
        const port = this.options.scrollport;
        return Math.max(0, Math.min(Math.max(0, port.scrollHeight - port.clientHeight), top));
    }

    private anchorTarget(snapshot: ReadingSnapshot): number | null {
        const port = this.options.scrollport;
        const anchor = this.options.getAnchors().find(candidate => candidate.id === snapshot.anchorId
            && port.contains(candidate.element));
        if (!anchor) return null;
        const rect = anchor.element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return this.clampTop(port.scrollTop + rect.top - port.getBoundingClientRect().top - snapshot.offset);
    }

    private writeTop(target: number): void {
        const port = this.options.scrollport;
        if (Math.abs(port.scrollTop - target) <= POSITION_TOLERANCE) return;
        // Scroll events arrive asynchronously, sometimes after restoration has
        // finished. Keep this marker until a real intent or different position.
        this.selfScrollTarget = target;
        port.scrollTop = target;
        this.selfScrollTarget = port.scrollTop;
    }

    private scheduleFrame(instance: Restoration): void {
        if (!this.ownerWindow) return;
        const version = this.scheduleVersion;
        this.frame = this.ownerWindow.requestAnimationFrame(() => {
            if (!this.isCurrent(instance, version)) return;
            this.frame = null;
            if (!this.hasReadyLayout()) {
                this.stopScheduledWork();
                return;
            }
            instance.attempts += 1;
            const target = this.anchorTarget(instance.snapshot);
            if (target !== null) {
                this.writeTop(target);
                if (instance.previousTarget !== undefined
                    && Math.abs(instance.previousTarget - target) <= POSITION_TOLERANCE) {
                    this.cancelRestore();
                    return;
                }
                instance.previousTarget = target;
            }
            if (instance.attempts >= MAX_LAYOUT_ATTEMPTS) {
                this.finishAtAvailablePosition(instance);
                return;
            }
            this.scheduleFrame(instance);
        });
    }

    private finishAtAvailablePosition(instance: Restoration): void {
        const target = this.anchorTarget(instance.snapshot) ?? this.clampTop(instance.snapshot.fallbackTop);
        this.writeTop(target);
        this.cancelRestore();
    }

    private isCurrent(instance: Restoration, version: number): boolean {
        return !this.disposed && this.restoration === instance && this.scheduleVersion === version;
    }

    private stopScheduledWork(): void {
        if (this.frame !== null) this.ownerWindow?.cancelAnimationFrame(this.frame);
        if (this.timeout !== null) this.ownerWindow?.clearTimeout(this.timeout);
        this.frame = null;
        this.timeout = null;
        this.scheduleVersion += 1;
        if (this.restoration) {
            this.restoration.started = false;
            this.restoration.attempts = 0;
            this.restoration.previousTarget = undefined;
        }
    }

    private readonly onIntent = (): void => {
        if (this.disposed || !this.hasVisibleLayout()) return;
        this.selfScrollTarget = null;
        this.cancelRestore();
        this.options.onUserIntent();
    };

    private readonly onScroll = (): void => {
        if (this.disposed || !this.hasVisibleLayout()) return;
        if (this.selfScrollTarget !== null
            && Math.abs(this.options.scrollport.scrollTop - this.selfScrollTarget) <= POSITION_TOLERANCE) return;
        this.selfScrollTarget = null;
        // Normal host auto-follow also emits scroll. Only an unexpected scroll
        // competing with our restoration is cancellation evidence on its own.
        if (this.restoration) this.onIntent();
        this.capture();
    };
}

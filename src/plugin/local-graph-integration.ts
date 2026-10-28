import type { LocalGraph } from "../local-graph";
import type { PlatformTimeoutHandle } from "../platform-dom";

interface HoverPopoverCandidate {
    instanceOf(candidate: new () => unknown): boolean;
    matches(selector: string): boolean;
    querySelector(selector: string): Element | null;
}

export interface LocalGraphIntegrationDependencies {
    createGraph(): LocalGraph;
    isDesktop(): boolean;
    createMutationObserver(callback: MutationCallback): MutationObserver;
    getObservedBody(): Element;
    getStartupDocument?(): Document | undefined;
    setTimer(callback: () => void, ms: number): PlatformTimeoutHandle;
    clearTimer(handle: PlatformTimeoutHandle): void;
    log(message: string, ...args: unknown[]): void;
}

const HOVER_POPOVER_SELECTOR = ".popover.hover-popover.hover-editor";
const HOVER_RESIZE_DEBOUNCE_MS = 150;

export class LocalGraphIntegration {
    private graph: LocalGraph | null = null;
    private observer: MutationObserver | null = null;
    private resizeTimer: PlatformTimeoutHandle | null = null;
    private readonly resizeCandidates: HTMLElement[] = [];

    constructor(private readonly dependencies: LocalGraphIntegrationDependencies) {}

    startup(): Promise<void> {
        const startupDocument = this.dependencies.getStartupDocument?.();
        if (this.dependencies.isDesktop() && startupDocument?.body) {
            this.observeBody(startupDocument.body);
        }
        return this.getGraph().startup();
    }

    updateGraphColors(): Promise<void> {
        return this.getGraph().updateGraphColors();
    }

    applyOptionsToOpenGraphs(): Promise<void> {
        return this.getGraph().applyOptionsToOpenGraphs();
    }

    setupObserver(): void {
        if (!this.dependencies.isDesktop()) return;

        this.ensureObserver();
        this.observeBody(this.dependencies.getObservedBody());
    }

    disposeObserver(): void {
        if (this.resizeTimer !== null) {
            this.dependencies.clearTimer(this.resizeTimer);
            this.resizeTimer = null;
        }
        this.observer?.disconnect();
        this.observer = null;
    }

    private ensureObserver(): MutationObserver {
        return (this.observer ??= this.dependencies.createMutationObserver((mutations) => {
            this.handleMutations(mutations);
        }));
    }

    private observeBody(body: Element): void {
        const observer = this.ensureObserver();
        observer.observe(body, { childList: true });
    }

    private getGraph(): LocalGraph {
        return (this.graph ??= this.dependencies.createGraph());
    }

    private handleMutations(mutations: MutationRecord[]): void {
        for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
                const candidate = node as unknown as HoverPopoverCandidate;
                if (!candidate.instanceOf(HTMLElement)) continue;
                const hover = candidate.matches(HOVER_POPOVER_SELECTOR)
                    ? candidate as unknown as HTMLElement
                    : candidate.querySelector(HOVER_POPOVER_SELECTOR);
                if (
                    hover
                    && (hover as unknown as HoverPopoverCandidate).instanceOf(HTMLElement)
                    && hover.querySelector('[data-type="localgraph"]') !== null
                ) {
                    this.scheduleHoverResize(hover as unknown as HTMLElement);
                }
            }
        }
    }

    private scheduleHoverResize(candidate: HTMLElement): void {
        if (!this.resizeCandidates.includes(candidate)) this.resizeCandidates.push(candidate);
        if (this.resizeTimer !== null) {
            this.dependencies.clearTimer(this.resizeTimer);
            this.resizeTimer = null;
        }
        this.resizeTimer = this.dependencies.setTimer(() => {
            this.resizeTimer = null;
            if (!this.observer) return;
            const candidates = this.resizeCandidates.splice(0, this.resizeCandidates.length);
            for (const current of candidates) {
                if (!current.isConnected) continue;
                void this.getGraph().resize(current).catch((error) => {
                    this.dependencies.log("Failed to resize hover local graph", error);
                });
            }
        }, HOVER_RESIZE_DEBOUNCE_MS);
    }
}

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

    constructor(private readonly dependencies: LocalGraphIntegrationDependencies) {}

    startup(): Promise<void> {
        return this.getGraph().startup();
    }

    updateGraphColors(): Promise<void> {
        return this.getGraph().updateGraphColors();
    }

    applyOptionsToOpenGraphs(): Promise<void> {
        return this.getGraph().applyOptionsToOpenGraphs();
    }

    setupObserver(): void {
        if (!this.dependencies.isDesktop() || this.observer) return;

        this.observer = this.dependencies.createMutationObserver((mutations) => {
            this.handleMutations(mutations);
        });
        this.observer.observe(this.dependencies.getObservedBody(), {
            childList: true,
        });
    }

    disposeObserver(): void {
        if (this.resizeTimer !== null) {
            this.dependencies.clearTimer(this.resizeTimer);
            this.resizeTimer = null;
        }
        this.observer?.disconnect();
        this.observer = null;
    }

    private getGraph(): LocalGraph {
        return (this.graph ??= this.dependencies.createGraph());
    }

    private handleMutations(mutations: MutationRecord[]): void {
        for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
                const candidate = node as unknown as HoverPopoverCandidate;
                if (
                    candidate.instanceOf(HTMLElement)
                    && (
                        candidate.matches(HOVER_POPOVER_SELECTOR)
                        || candidate.querySelector(HOVER_POPOVER_SELECTOR) !== null
                    )
                ) {
                    this.scheduleHoverResize();
                    return;
                }
            }
        }
    }

    private scheduleHoverResize(): void {
        if (this.resizeTimer !== null) {
            this.dependencies.clearTimer(this.resizeTimer);
            this.resizeTimer = null;
        }
        this.resizeTimer = this.dependencies.setTimer(() => {
            this.resizeTimer = null;
            if (!this.observer) return;
            void this.getGraph().resize().catch((error) => {
                this.dependencies.log("Failed to resize hover local graph", error);
            });
        }, HOVER_RESIZE_DEBOUNCE_MS);
    }
}

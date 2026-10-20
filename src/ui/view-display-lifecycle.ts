interface WorkspaceLike {
    on?: (name: string, callback: () => void) => unknown;
    offref?: (ref: unknown) => void;
}

interface ContainerLike {
    ownerDocument: Document | null;
    isConnected: boolean;
    getBoundingClientRect?: () => { width: number; height: number };
}

export interface ViewDisplayLifecycleCallbacks {
    onVisibilityChange(visible: boolean): void;
    onDocumentChange(document: Document | null): void;
}

function hasLayout(container: ContainerLike): boolean {
    if (!container.isConnected) return false;
    if (container.ownerDocument?.visibilityState === 'hidden') return false;
    const rect = container.getBoundingClientRect?.();
    return rect === undefined || (rect.width > 0 && rect.height > 0);
}

export class ViewDisplayLifecycle {
    private readonly container: HTMLElement;
    private readonly workspace: WorkspaceLike | null;
    private readonly callbacks: ViewDisplayLifecycleCallbacks;
    private readonly observer: ResizeObserver | null;
    private readonly eventRefs: Array<{ name: string; ref: unknown }> = [];
    private document: Document | null;
    private visible = true;
    private disposed = false;

    constructor(
        container: HTMLElement,
        workspace: WorkspaceLike | null,
        callbacks: ViewDisplayLifecycleCallbacks,
    ) {
        this.container = container;
        this.workspace = workspace;
        this.callbacks = callbacks;
        this.document = container.ownerDocument;
        this.observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => this.refresh())
            : null;
    }

    start(): void {
        if (this.disposed) return;
        for (const name of ['layout-change', 'active-leaf-change']) {
            const ref = this.workspace?.on?.(name, () => this.refresh());
            if (ref !== undefined) this.eventRefs.push({ name, ref });
        }
        this.observer?.observe(this.container);
        this.document?.addEventListener?.('visibilitychange', this.handleDocumentChange);
        this.refresh();
    }

    refresh(): void {
        if (this.disposed) return;
        if (this.container.ownerDocument !== this.document) {
            const previousDocument = this.document;
            this.document = this.container.ownerDocument;
            previousDocument?.removeEventListener?.('visibilitychange', this.handleDocumentChange);
            this.document?.addEventListener?.('visibilitychange', this.handleDocumentChange);
            this.callbacks.onDocumentChange(this.document);
        }
        const nextVisible = hasLayout(this.container);
        if (nextVisible === this.visible) return;
        this.visible = nextVisible;
        this.callbacks.onVisibilityChange(nextVisible);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.observer?.disconnect();
        for (const event of this.eventRefs) {
            this.workspace?.offref?.(event.ref);
        }
        this.eventRefs.length = 0;
        this.document?.removeEventListener?.('visibilitychange', this.handleDocumentChange);
    }

    private readonly handleDocumentChange = (): void => {
        this.refresh();
    };
}

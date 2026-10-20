import type { Component } from 'obsidian';

export type NativeMarkdownRenderPhase = 'primary' | 'fallback' | 'error';

export interface NativeMarkdownInput {
    content: string;
    sourcePath: string;
    mode: 'full' | 'deferred-mermaid';
    deferMermaid: boolean;
    coalesce?: boolean;
    observeMermaidLayout?: boolean;
    forceScroll?: boolean;
    onScrollSettled?: () => void;
}

export interface NativeMarkdownPrepared {
    input: NativeMarkdownInput;
    markdown: string;
    mermaidSources: string[];
    deferred: boolean;
    attachStaging: boolean;
    phase: NativeMarkdownRenderPhase;
}

export interface NativeMarkdownBridgeState {
    held: boolean;
    displayPaused: boolean;
    updateAvailable: boolean;
    rendering: boolean;
    disposed: boolean;
}

interface NativeMarkdownOperation {
    input: NativeMarkdownInput;
    buffer: HTMLElement;
    owner?: Component;
    prepared: NativeMarkdownPrepared;
    current: boolean;
    settled: boolean;
    promise: Promise<boolean>;
    resolve: (published: boolean) => void;
}

interface NativeMarkdownScheduler {
    setTimeout(callback: () => void, milliseconds: number): unknown;
    clearTimeout(timer: unknown): void;
    now(): number;
}

export interface NativeMarkdownBridgeCallbacks {
    createOwner(): Component;
    unloadOwner(owner?: Component | null): void;
    detachOwner?(owner?: Component | null): void;
    createBuffer(): HTMLElement;
    prepare(input: NativeMarkdownInput, phase: NativeMarkdownRenderPhase): NativeMarkdownPrepared;
    render(prepared: NativeMarkdownPrepared, buffer: HTMLElement, owner?: Component): Promise<void>;
    renderError(prepared: NativeMarkdownPrepared, buffer: HTMLElement, error: unknown): void;
    shouldFallback(input: NativeMarkdownInput): boolean;
    canPublish(input: NativeMarkdownInput): boolean;
    onPublish(prepared: NativeMarkdownPrepared, buffer: HTMLElement, owner?: Component): void;
    onStateChange?(state: NativeMarkdownBridgeState): void;
}

function sameInput(left: NativeMarkdownInput, right: NativeMarkdownInput): boolean {
    return left.content === right.content
        && left.sourcePath === right.sourcePath
        && left.mode === right.mode
        && left.deferMermaid === right.deferMermaid;
}

function compatibleAppendInput(left: NativeMarkdownInput, right: NativeMarkdownInput): boolean {
    return left.sourcePath === right.sourcePath
        && left.mode === right.mode
        && left.deferMermaid === right.deferMermaid
        && right.content.startsWith(left.content);
}

function schedulerFor(document: Document | null): NativeMarkdownScheduler {
    const ownerWindow = document?.defaultView;
    if (ownerWindow) {
        return {
            setTimeout: (callback, milliseconds) => ownerWindow.setTimeout(callback, milliseconds),
            clearTimeout: timer => ownerWindow.clearTimeout(timer as number),
            now: () => ownerWindow.performance.now(),
        };
    }
    const globalScope = globalThis as typeof globalThis & { performance?: { now(): number } };
    return {
        setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
        clearTimeout: timer => globalThis.clearTimeout(timer as number),
        now: () => globalScope.performance?.now() ?? Date.now(),
    };
}

function clearChildren(host: HTMLElement): void {
    host.replaceChildren();
}

function appendChild(host: HTMLElement, child: HTMLElement): void {
    host.appendChild(child);
}

function removeChild(host: HTMLElement | null, child: HTMLElement): void {
    if (!host || !child.parentElement) return;
    host.removeChild(child);
}

function selectionIntersectsHost(document: Document | null, host: HTMLElement): boolean {
    const selection = document?.getSelection?.();
    if (!selection || selection.isCollapsed) return false;
    for (let index = 0; index < selection.rangeCount; index += 1) {
        if (selection.getRangeAt(index).intersectsNode(host)) return true;
    }
    return false;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
    const element = target as { tagName?: string } | null;
    if (!element?.tagName) return false;
    return ['SUMMARY', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName.toUpperCase());
}

export class NativeMarkdownBridge {
    private readonly host: HTMLElement;
    private readonly callbacks: NativeMarkdownBridgeCallbacks;
    private readonly cooldownMs: number;
    private readonly displayPauseReasons = new Set<string>();
    private ownerDocument: Document | null;
    private scheduler: NativeMarkdownScheduler;
    private timer: unknown;
    private liveInput: NativeMarkdownInput | null = null;
    private liveBuffer: HTMLElement | null = null;
    private liveOwner: Component | null = null;
    private pendingInput: NativeMarkdownInput | null = null;
    private operation: NativeMarkdownOperation | null = null;
    private held = false;
    private disposed = false;
    private lastSettleAt = -Infinity;

    constructor(
        host: HTMLElement,
        ownerDocument: Document | null,
        callbacks: NativeMarkdownBridgeCallbacks,
        cooldownMs = 32,
    ) {
        this.host = host;
        this.ownerDocument = ownerDocument;
        this.callbacks = callbacks;
        this.cooldownMs = cooldownMs;
        this.scheduler = schedulerFor(ownerDocument);
        this.bindDocumentListeners();
    }

    getState(): NativeMarkdownBridgeState {
        return {
            held: this.held,
            displayPaused: this.displayPauseReasons.size > 0,
            updateAvailable: this.pendingInput !== null
                && (this.liveInput === null || !sameInput(this.pendingInput, this.liveInput)),
            rendering: this.operation !== null,
            disposed: this.disposed,
        };
    }

    isLive(input: NativeMarkdownInput): boolean {
        return !this.disposed && this.liveInput !== null && sameInput(this.liveInput, input);
    }

    request(input: NativeMarkdownInput): Promise<boolean> {
        if (this.disposed || !this.callbacks.canPublish(input)) return Promise.resolve(false);
        if (this.liveInput && sameInput(this.liveInput, input)) {
            this.clearTimer();
            this.pendingInput = null;
            if (this.operation) this.operation.current = false;
            this.notifyStateChange();
            return Promise.resolve(true);
        }

        this.pendingInput = input;
        this.notifyStateChange();
        const operation = this.operation;
        if (this.paused()) {
            if (operation) operation.current &&= sameInput(operation.input, input);
            return Promise.resolve(true);
        }

        if (operation) {
            operation.current &&= compatibleAppendInput(operation.input, input);
            if (sameInput(operation.input, input)) return operation.promise;
            return Promise.resolve(true);
        }

        if (!input.coalesce) this.clearTimer();
        this.scheduleDrain(input.coalesce && this.liveInput?.content ? this.remainingCooldown() : 0);
        const started = this.operation;
        return started && sameInput(started.input, input) ? started.promise : Promise.resolve(true);
    }

    setHeld(held: boolean): void {
        if (this.held === held) return;
        this.held = held;
        if (held) this.acceptPausedOperation();
        this.notifyStateChange();
    }

    setDisplayPaused(reason: string, paused: boolean): void {
        if (paused) this.displayPauseReasons.add(reason);
        else this.displayPauseReasons.delete(reason);
        if (paused) this.acceptPausedOperation();
        this.notifyStateChange();
        if (!paused && !this.paused() && this.pendingInput) this.scheduleDrain(0);
    }

    showLatest(): void {
        if (this.disposed) return;
        this.setHeld(false);
        if (!this.paused() && this.pendingInput) this.scheduleDrain(0);
    }

    cancelPending(): void {
        this.pendingInput = null;
        this.clearTimer();
        this.notifyStateChange();
    }

    async settleBeforeFinal(input: NativeMarkdownInput): Promise<boolean> {
        this.clearTimer();
        if (this.paused()) return !this.disposed;
        const operation = this.operation;
        if (!operation || !sameInput(operation.input, input)) return true;
        await operation.promise;
        return !this.disposed;
    }

    cancel(): void {
        this.dispose(false);
    }

    dispose(clearHost = true): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clearTimer();
        this.pendingInput = null;
        this.unbindDocumentListeners();
        if (this.liveOwner) this.callbacks.unloadOwner(this.liveOwner);
        this.liveOwner = null;
        this.liveInput = null;
        if (this.operation) {
            this.operation.current = false;
            // A started native render can still register owner cleanups. Detach
            // it from view-level teardown and let this operation release it.
            if (this.operation.owner) this.callbacks.detachOwner?.(this.operation.owner);
            if (!this.operation.settled) {
                this.operation.settled = true;
                this.operation.resolve(false);
            }
        }
        this.liveBuffer = null;
        if (clearHost) clearChildren(this.host);
        this.notifyStateChange();
    }

    rebindDocument(nextDocument: Document | null): void {
        if (this.ownerDocument === nextDocument || this.disposed) return;
        this.unbindDocumentListeners();
        this.clearTimer();
        this.ownerDocument = nextDocument;
        this.scheduler = schedulerFor(nextDocument);
        this.bindDocumentListeners();
        if (!this.paused() && this.pendingInput) this.scheduleDrain(0);
    }

    private paused(): boolean {
        return this.held || this.displayPauseReasons.size > 0 || this.disposed;
    }

    private acceptPausedOperation(): void {
        this.clearTimer();
        const operation = this.operation;
        if (!operation) return;
        this.pendingInput ??= operation.input;
        operation.current &&= sameInput(operation.input, this.pendingInput);
        this.resolveOperation(operation, this.callbacks.canPublish(operation.input));
    }

    private remainingCooldown(): number {
        return Math.max(0, this.cooldownMs - (this.scheduler.now() - this.lastSettleAt));
    }

    private notifyStateChange(): void {
        this.callbacks.onStateChange?.(this.getState());
    }

    private bindDocumentListeners(): void {
        this.ownerDocument?.addEventListener?.('pointerdown', this.onPointerDown, true);
        this.ownerDocument?.addEventListener?.('selectionchange', this.onSelectionChange);
        this.ownerDocument?.addEventListener?.('focusin', this.onFocusIn, true);
    }

    private unbindDocumentListeners(): void {
        this.ownerDocument?.removeEventListener?.('pointerdown', this.onPointerDown, true);
        this.ownerDocument?.removeEventListener?.('selectionchange', this.onSelectionChange);
        this.ownerDocument?.removeEventListener?.('focusin', this.onFocusIn, true);
    }

    private readonly onPointerDown = (event: Event): void => {
        if (!this.host.contains(event.target as Node | null)) return;
        this.setHeld(true);
    };

    private readonly onSelectionChange = (): void => {
        if (selectionIntersectsHost(this.ownerDocument, this.host)) this.setHeld(true);
    };

    private readonly onFocusIn = (event: Event): void => {
        if (!this.host.contains(event.target as Node | null) || !isInteractiveTarget(event.target)) return;
        this.setHeld(true);
    };

    private clearTimer(): void {
        if (this.timer === undefined || this.timer === null) return;
        this.scheduler.clearTimeout(this.timer);
        this.timer = undefined;
        this.notifyStateChange();
    }

    private scheduleDrain(delayMs: number): void {
        if (this.timer !== undefined && this.timer !== null) return;
        if (!this.pendingInput || this.operation || this.paused()) return;
        if (delayMs <= 0) {
            const input = this.pendingInput;
            this.startOperation(input);
            return;
        }
        this.timer = this.scheduler.setTimeout(() => {
            this.timer = undefined;
            const input = this.pendingInput;
            if (!input || this.operation || this.paused()) return;
            const remaining = input.coalesce ? this.remainingCooldown() : 0;
            if (remaining > 0) {
                this.scheduleDrain(remaining);
                return;
            }
            this.startOperation(input);
        }, Math.max(0, delayMs));
    }

    private startOperation(input: NativeMarkdownInput): void {
        this.pendingInput = null;
        if (!this.callbacks.canPublish(input)) {
            this.notifyStateChange();
            return;
        }
        let resolve!: (published: boolean) => void;
        const promise = new Promise<boolean>(nextResolve => { resolve = nextResolve; });
        let prepared: NativeMarkdownPrepared;
        try {
            prepared = this.callbacks.prepare(input, 'primary');
        } catch (error) {
            void this.handlePrepareError(input, error, resolve);
            return;
        }
        const owner = this.callbacks.createOwner();
        const buffer = this.callbacks.createBuffer();
        buffer.classList.add('message-render-buffer');
        if (prepared.attachStaging) {
            buffer.classList.add('pa-native-markdown-staging');
            buffer.setAttribute('aria-hidden', 'true');
            buffer.inert = true;
            appendChild(this.host, buffer);
        }
        const operation: NativeMarkdownOperation = {
            input, buffer, owner, prepared, current: true, settled: false,
            promise, resolve,
        };
        this.operation = operation;
        this.notifyStateChange();
        void this.runOperation(operation);
    }

    private async runOperation(operation: NativeMarkdownOperation): Promise<void> {
        try {
            await this.callbacks.render(operation.prepared, operation.buffer, operation.owner);
        } catch (error) {
            this.retireOperationResources(operation);
            if (!this.canContinue(operation) || this.paused() || !this.callbacks.canPublish(operation.input)) {
                this.finishOperation(operation);
                return;
            }
            if (!this.callbacks.shouldFallback(operation.input)) {
                if (this.canContinue(operation)) {
                    try {
                        const errorPrepared = this.callbacks.prepare(operation.input, 'error');
                        const errorBuffer = this.callbacks.createBuffer();
                        errorBuffer.classList.add('message-render-buffer');
                        this.callbacks.renderError(errorPrepared, errorBuffer, error);
                        operation.prepared = errorPrepared;
                        operation.buffer = errorBuffer;
                        operation.owner = undefined;
                    } catch {
                        // Keep the bridge usable; the next request can render again.
                    }
                }
                this.finishOperation(operation);
                return;
            }
            try {
                const fallbackPrepared = this.callbacks.prepare(operation.input, 'fallback');
                const fallbackOwner = this.callbacks.createOwner();
                const fallbackBuffer = this.callbacks.createBuffer();
                fallbackBuffer.classList.add('message-render-buffer');
                operation.prepared = fallbackPrepared;
                operation.owner = fallbackOwner;
                operation.buffer = fallbackBuffer;
                if (fallbackPrepared.attachStaging) {
                    fallbackBuffer.classList.add('pa-native-markdown-staging');
                    fallbackBuffer.setAttribute('aria-hidden', 'true');
                    fallbackBuffer.inert = true;
                    appendChild(this.host, fallbackBuffer);
                }
                await this.callbacks.render(fallbackPrepared, fallbackBuffer, fallbackOwner);
            } catch (fallbackError) {
                this.retireOperationResources(operation);
                const errorPrepared = this.callbacks.prepare(operation.input, 'error');
                const errorBuffer = this.callbacks.createBuffer();
                errorBuffer.classList.add('message-render-buffer');
                this.callbacks.renderError(errorPrepared, errorBuffer, fallbackError);
                operation.prepared = errorPrepared;
                operation.buffer = errorBuffer;
                operation.owner = undefined;
            }
        }
        this.finishOperation(operation);
    }

    private async handlePrepareError(
        input: NativeMarkdownInput,
        error: unknown,
        resolve: (published: boolean) => void,
    ): Promise<void> {
        let prepared: NativeMarkdownPrepared;
        try {
            prepared = this.callbacks.prepare(input, 'error');
        } catch {
            this.lastSettleAt = this.scheduler.now();
            resolve(true);
            this.notifyStateChange();
            return;
        }
        const buffer = this.callbacks.createBuffer();
        this.callbacks.renderError(prepared, buffer, error);
        this.lastSettleAt = this.scheduler.now();
        if (this.disposed) {
            resolve(false);
        } else if (this.paused()) {
            this.pendingInput = input;
            resolve(true);
        } else if (!this.callbacks.canPublish(input)) {
            resolve(false);
        } else {
            this.publish(prepared, buffer, undefined);
            resolve(true);
        }
        this.notifyStateChange();
    }

    private canContinue(operation: NativeMarkdownOperation): boolean {
        return !this.disposed && operation.current;
    }

    private resolveOperation(operation: NativeMarkdownOperation, result: boolean): void {
        if (operation.settled) return;
        operation.settled = true;
        operation.resolve(result);
    }

    private retireOperationResources(operation: NativeMarkdownOperation): void {
        if (operation.owner) this.callbacks.unloadOwner(operation.owner);
        operation.owner = undefined;
        removeChild(this.host, operation.buffer);
        operation.buffer.remove();
    }

    private finishOperation(operation: NativeMarkdownOperation): void {
        if (this.operation === operation) this.operation = null;
        const latest = this.pendingInput;
        const valid = this.canContinue(operation) && this.callbacks.canPublish(operation.input);
        const acceptedPause = this.paused() && valid;
        const canPublish = this.canContinue(operation)
            && !this.paused()
            && (!latest || sameInput(latest, operation.input) || compatibleAppendInput(operation.input, latest))
            && valid;

        if (!canPublish) {
            this.retireOperationResources(operation);
            this.lastSettleAt = operation.input.content ? this.scheduler.now() : -Infinity;
            if (acceptedPause) {
                this.pendingInput = latest ?? operation.input;
                this.resolveOperation(operation, true);
            } else {
                this.resolveOperation(operation, false);
                if (operation.current && !this.callbacks.canPublish(operation.input)) {
                    this.pendingInput = null;
                    this.clearTimer();
                } else if (this.pendingInput && !this.paused()) {
                    this.scheduleDrain(this.pendingInput.coalesce ? this.remainingCooldown() : 0);
                }
            }
            this.notifyStateChange();
            return;
        }

        if (latest && sameInput(latest, operation.input)) this.pendingInput = null;
        this.publish(operation.prepared, operation.buffer, operation.owner);
        this.resolveOperation(operation, true);
        this.lastSettleAt = operation.input.content ? this.scheduler.now() : -Infinity;
        if (!this.paused() && this.pendingInput) {
            this.scheduleDrain(this.pendingInput.coalesce ? this.remainingCooldown() : 0);
        }
        this.notifyStateChange();
    }

    private publish(
        prepared: NativeMarkdownPrepared,
        buffer: HTMLElement,
        owner?: Component,
    ): void {
        if (!this.callbacks.canPublish(prepared.input)) {
            if (owner) this.callbacks.unloadOwner(owner);
            removeChild(this.host, buffer);
            buffer.remove();
            return;
        }
        if (this.liveOwner && this.liveOwner !== owner) this.callbacks.unloadOwner(this.liveOwner);
        if (this.liveBuffer && this.liveBuffer !== buffer) removeChild(this.host, this.liveBuffer);
        clearChildren(this.host);
        buffer.classList.remove('pa-native-markdown-staging');
        buffer.removeAttribute('aria-hidden');
        buffer.inert = false;
        buffer.hidden = false;
        appendChild(this.host, buffer);
        this.liveInput = prepared.input;
        this.liveBuffer = buffer;
        this.liveOwner = owner ?? null;
        this.callbacks.onPublish({
            ...prepared,
            input: {
                ...prepared.input,
                onScrollSettled: () => {
                    if (this.liveBuffer !== buffer || this.paused()) return;
                    this.lastSettleAt = prepared.input.content ? this.scheduler.now() : -Infinity;
                    prepared.input.onScrollSettled?.();
                },
            },
        }, buffer, owner);
    }
}

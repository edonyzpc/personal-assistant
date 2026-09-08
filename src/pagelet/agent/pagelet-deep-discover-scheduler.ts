import type {
    PageletDeepDiscoverController,
    PageletDeepDiscoverControllerRequest,
} from "./pagelet-deep-discover-controller";
import type {
    PageletAgentValidationIdentity,
    PageletDeepDiscoverControllerResult,
} from "./types";

interface ScheduledRequest {
    request: PageletDeepDiscoverControllerRequest;
    automaticEpoch: number;
    timer?: ReturnType<typeof setTimeout>;
    ready: boolean;
    waiters: Array<{
        resolve(result: PageletDeepDiscoverControllerResult): void;
    }>;
}

interface ExplicitRequest {
    request: PageletDeepDiscoverControllerRequest;
    settled: boolean;
    started: boolean;
    abortListener?: () => void;
    resolve(result: PageletDeepDiscoverControllerResult): void;
}

interface ActiveScheduledRun {
    kind: "automatic" | "explicit";
    request: PageletDeepDiscoverControllerRequest;
    preemptedByExplicit: boolean;
    settle(result: PageletDeepDiscoverControllerResult): void;
}

export interface PageletDeepDiscoverSchedulerOptions {
    controller: PageletDeepDiscoverController;
    delayMs?: number;
    setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Host-agnostic debounce/coalescing seam for leave/open/edit-idle triggers.
 * It stores paths and trigger metadata only; snapshots and provider/tool
 * dependencies stay owned by the controller/runtime.
 */
export class PageletDeepDiscoverScheduler {
    private readonly pending = new Map<string, ScheduledRequest>();
    private readonly delayMs: number;
    private readonly setTimer: NonNullable<PageletDeepDiscoverSchedulerOptions["setTimer"]>;
    private readonly clearTimer: NonNullable<PageletDeepDiscoverSchedulerOptions["clearTimer"]>;
    private readonly readyPaths: string[] = [];
    private readonly explicitQueue: ExplicitRequest[] = [];
    private activeRun?: ActiveScheduledRun;
    private disposed = false;
    private automaticEnabled = true;
    private automaticEpoch = 0;

    constructor(private readonly options: PageletDeepDiscoverSchedulerOptions) {
        this.delayMs = Math.max(0, options.delayMs ?? 5_000);
        this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
        this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    }

    schedule(
        request: PageletDeepDiscoverControllerRequest,
    ): Promise<PageletDeepDiscoverControllerResult> {
        if (request.triggerReason === "explicit") return this.runNow(request);
        if (this.disposed || !this.automaticEnabled || request.signal?.aborted) {
            return Promise.resolve({ status: "quiet", reason: "aborted" });
        }
        const existing = this.pending.get(request.path);
        if (existing?.timer) this.clearTimer(existing.timer);

        return new Promise((resolve) => {
            const waiters = existing?.waiters ?? [];
            waiters.push({ resolve });
            const pending: ScheduledRequest = {
                request,
                automaticEpoch: this.automaticEpoch,
                waiters,
                ready: existing?.ready ?? false,
            };
            if (!pending.ready) {
                pending.timer = this.setTimer(() => {
                    if (
                        pending.automaticEpoch === this.automaticEpoch
                        && this.pending.get(request.path) === pending
                    ) this.markReady(request.path);
                }, this.delayMs);
            }
            this.pending.set(request.path, pending);
        });
    }

    async runNow(
        request: PageletDeepDiscoverControllerRequest,
    ): Promise<PageletDeepDiscoverControllerResult> {
        // The trusted trigger identifies user intent. Cache bypass alone never
        // promotes background work into the explicit lane.
        if (request.triggerReason !== "explicit") return this.schedule(request);
        if (this.disposed || request.signal?.aborted) {
            return { status: "quiet", reason: "aborted" };
        }
        this.cancelPending(request.path);
        return await new Promise((resolve) => {
            const explicit: ExplicitRequest = {
                request,
                resolve,
                settled: false,
                started: false,
            };
            if (request.signal) {
                explicit.abortListener = () => {
                    if (explicit.settled) return;
                    if (explicit.started) {
                        this.options.controller.cancel();
                    } else {
                        const index = this.explicitQueue.indexOf(explicit);
                        if (index >= 0) this.explicitQueue.splice(index, 1);
                    }
                    this.settleExplicit(explicit, abortedResult());
                };
                request.signal.addEventListener("abort", explicit.abortListener, { once: true });
            }
            this.explicitQueue.push(explicit);
            if (this.activeRun?.kind === "automatic") {
                this.activeRun.preemptedByExplicit = true;
                this.options.controller.cancel();
            }
            this.pump();
        });
    }

    async flush(path: string): Promise<PageletDeepDiscoverControllerResult | null> {
        const pending = this.pending.get(path);
        if (!pending) return null;
        return await new Promise((resolve) => {
            pending.waiters.push({ resolve });
            if (pending.timer) this.clearTimer(pending.timer);
            pending.timer = undefined;
            this.markReady(path);
        });
    }

    cancelPending(path: string): void {
        const pending = this.pending.get(path);
        if (!pending) return;
        this.pending.delete(path);
        if (pending.timer) this.clearTimer(pending.timer);
        const result: PageletDeepDiscoverControllerResult = {
            status: "quiet",
            reason: "aborted",
        };
        for (const waiter of pending.waiters) waiter.resolve(result);
    }

    /** Pause only future/background work, preserving explicit work and cache. */
    setAutomaticEnabled(enabled: boolean): void {
        if (this.disposed || this.automaticEnabled === enabled) return;
        this.automaticEnabled = enabled;
        this.automaticEpoch += 1;
        if (enabled) return;
        for (const path of [...this.pending.keys()]) this.cancelPending(path);
        this.readyPaths.length = 0;
        if (this.activeRun?.kind === "automatic") {
            this.options.controller.cancel();
            this.activeRun.settle(abortedResult());
        }
    }

    /** Provider-free exact-source validation for delivered Pagelet actions. */
    async validateInsight(
        identity: PageletAgentValidationIdentity,
        signal?: AbortSignal,
    ): Promise<boolean> {
        if (this.disposed || signal?.aborted) return false;
        return await this.options.controller.validateInsight(identity, signal);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const path of [...this.pending.keys()]) this.cancelPending(path);
        this.readyPaths.length = 0;
        for (const explicit of this.explicitQueue.splice(0)) {
            this.settleExplicit(explicit, abortedResult());
        }
        this.activeRun?.settle(abortedResult());
        this.options.controller.dispose();
    }

    private markReady(path: string): void {
        if (!this.automaticEnabled || this.disposed) return;
        const pending = this.pending.get(path);
        if (!pending) return;
        pending.timer = undefined;
        if (!pending.ready) {
            pending.ready = true;
            this.readyPaths.push(path);
        }
        this.pump();
    }

    private pump(): void {
        if (this.disposed || this.activeRun) return;

        const explicit = this.takeNextExplicit();
        if (explicit) {
            this.startExplicit(explicit);
            return;
        }

        if (!this.automaticEnabled) return;

        while (this.readyPaths.length > 0) {
            const path = this.readyPaths.shift();
            if (!path) continue;
            const pending = this.pending.get(path);
            if (!pending?.ready) continue;
            this.pending.delete(path);
            this.startAutomatic(pending);
            return;
        }
    }

    private takeNextExplicit(): ExplicitRequest | undefined {
        while (this.explicitQueue.length > 0) {
            const explicit = this.explicitQueue.shift();
            if (!explicit || explicit.settled) continue;
            if (explicit.request.signal?.aborted) {
                this.settleExplicit(explicit, abortedResult());
                continue;
            }
            explicit.started = true;
            return explicit;
        }
        return undefined;
    }

    private startExplicit(explicit: ExplicitRequest): void {
        this.startControllerRun(
            "explicit",
            explicit.request,
            (result) => this.settleExplicit(explicit, result),
        );
    }

    private startAutomatic(pending: ScheduledRequest): void {
        let settled = false;
        const isCurrent = () => (
            !this.disposed
            && this.automaticEnabled
            && pending.automaticEpoch === this.automaticEpoch
            && (pending.request.isAutomaticRequestCurrent?.() ?? true)
        );
        const request = { ...pending.request, isAutomaticRequestCurrent: isCurrent };
        const active = this.startControllerRun("automatic", request, (result) => {
            if (settled) return;
            settled = true;
            if (
                active.preemptedByExplicit
                && isCurrent()
                && result.status === "quiet"
                && result.reason === "aborted"
                && !this.hasQueuedExplicitForPath(pending.request.path)
            ) {
                this.requeueAutomatic(pending);
                return;
            }
            for (const waiter of pending.waiters) waiter.resolve(isCurrent() ? result : abortedResult());
        });
    }

    private startControllerRun(
        kind: ActiveScheduledRun["kind"],
        request: PageletDeepDiscoverControllerRequest,
        settle: (result: PageletDeepDiscoverControllerResult) => void,
    ): ActiveScheduledRun {
        const active: ActiveScheduledRun = {
            kind,
            request,
            preemptedByExplicit: false,
            settle,
        };
        this.activeRun = active;
        void this.runController(request)
            .then((result) => active.settle(result))
            .finally(() => {
                if (this.activeRun === active) this.activeRun = undefined;
                this.pump();
            });
        return active;
    }

    private async runController(
        request: PageletDeepDiscoverControllerRequest,
    ): Promise<PageletDeepDiscoverControllerResult> {
        try {
            return await this.options.controller.run(request);
        } catch {
            return { status: "error", reason: "deep-discover-failed" };
        }
    }

    private settleExplicit(
        explicit: ExplicitRequest,
        result: PageletDeepDiscoverControllerResult,
    ): void {
        if (explicit.settled) return;
        explicit.settled = true;
        this.removeExplicitAbortListener(explicit);
        explicit.resolve(result);
    }

    private removeExplicitAbortListener(explicit: ExplicitRequest): void {
        if (!explicit.abortListener || !explicit.request.signal) return;
        explicit.request.signal.removeEventListener("abort", explicit.abortListener);
        explicit.abortListener = undefined;
    }

    private requeueAutomatic(interrupted: ScheduledRequest): void {
        const path = interrupted.request.path;
        const newer = this.pending.get(path);
        if (!newer) {
            this.pending.set(path, {
                request: interrupted.request,
                automaticEpoch: interrupted.automaticEpoch,
                waiters: interrupted.waiters,
                ready: true,
            });
            this.readyPaths.push(path);
            return;
        }

        if (newer.timer) this.clearTimer(newer.timer);
        newer.timer = undefined;
        newer.waiters.unshift(...interrupted.waiters);
        if (!newer.ready) {
            newer.ready = true;
            this.readyPaths.push(path);
        }
    }

    private hasQueuedExplicitForPath(path: string): boolean {
        return this.explicitQueue.some((explicit) => (
            !explicit.settled && explicit.request.path === path
        ));
    }
}

function abortedResult(): PageletDeepDiscoverControllerResult {
    return { status: "quiet", reason: "aborted" };
}

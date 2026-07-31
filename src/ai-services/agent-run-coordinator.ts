import { createAbortError, throwIfAborted } from "./chat-utils";

export interface AgentRunLease {
    release(): void;
}

export interface AgentRunCoordinatorPort {
    acquireChatLease(signal?: AbortSignal): Promise<AgentRunLease>;
    acquirePageletTurnLease(signal?: AbortSignal): Promise<AgentRunLease>;
}

type AgentRunPriority = "chat" | "pagelet";

interface PendingLeaseRequest {
    readonly priority: AgentRunPriority;
    readonly signal?: AbortSignal;
    readonly resolve: (lease: AgentRunLease) => void;
    readonly reject: (error: unknown) => void;
    readonly onAbort: () => void;
    queued: boolean;
}

/**
 * Capacity-one coordinator for provider-backed Agent work.
 *
 * Chat owns one lease for its complete run. Pagelet acquires a fresh lease for
 * each turn, which gives an already-waiting Chat run priority at the turn
 * boundary without interrupting in-flight Pagelet work.
 */
export class AgentRunCoordinator implements AgentRunCoordinatorPort {
    private active = false;
    private readonly chatQueue: PendingLeaseRequest[] = [];
    private readonly pageletQueue: PendingLeaseRequest[] = [];

    async acquireChatLease(signal?: AbortSignal): Promise<AgentRunLease> {
        return this.acquire("chat", signal);
    }

    async acquirePageletTurnLease(signal?: AbortSignal): Promise<AgentRunLease> {
        return this.acquire("pagelet", signal);
    }

    private acquire(priority: AgentRunPriority, signal?: AbortSignal): Promise<AgentRunLease> {
        throwIfAborted(signal);

        return new Promise<AgentRunLease>((resolve, reject) => {
            const request: PendingLeaseRequest = {
                priority,
                signal,
                resolve,
                reject,
                queued: true,
                onAbort: () => this.abortPendingRequest(request),
            };
            signal?.addEventListener("abort", request.onAbort, { once: true });
            this.queueFor(priority).push(request);
            this.drain();
        });
    }

    private abortPendingRequest(request: PendingLeaseRequest): void {
        if (!request.queued) return;
        const queue = this.queueFor(request.priority);
        const index = queue.indexOf(request);
        if (index < 0) return;

        queue.splice(index, 1);
        request.queued = false;
        request.signal?.removeEventListener("abort", request.onAbort);
        request.reject(createAbortError());
        this.drain();
    }

    private drain(): void {
        if (this.active) return;
        const request = this.chatQueue.shift() ?? this.pageletQueue.shift();
        if (!request) return;

        request.queued = false;
        request.signal?.removeEventListener("abort", request.onAbort);
        this.active = true;
        request.resolve(this.createLease());
    }

    private createLease(): AgentRunLease {
        let released = false;
        return {
            release: () => {
                if (released) return;
                released = true;
                this.active = false;
                this.drain();
            },
        };
    }

    private queueFor(priority: AgentRunPriority): PendingLeaseRequest[] {
        return priority === "chat" ? this.chatQueue : this.pageletQueue;
    }
}

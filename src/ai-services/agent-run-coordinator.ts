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

/** Two reserved FIFO lanes keep one Chat and one background Pagelet progressing. */
export class AgentRunCoordinator implements AgentRunCoordinatorPort {
    private readonly active: Record<AgentRunPriority, boolean> = { chat: false, pagelet: false };
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
        this.drainLane("chat");
        this.drainLane("pagelet");
    }

    private drainLane(priority: AgentRunPriority): void {
        if (this.active[priority]) return;
        const request = this.queueFor(priority).shift();
        if (!request) return;
        request.queued = false;
        request.signal?.removeEventListener("abort", request.onAbort);
        this.active[priority] = true;
        request.resolve(this.createLease(priority));
    }

    private createLease(priority: AgentRunPriority): AgentRunLease {
        let released = false;
        return {
            release: () => {
                if (released) return;
                released = true;
                this.active[priority] = false;
                this.drain();
            },
        };
    }

    private queueFor(priority: AgentRunPriority): PendingLeaseRequest[] {
        return priority === "chat" ? this.chatQueue : this.pageletQueue;
    }
}

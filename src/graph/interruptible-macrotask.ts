export type InterruptibleMacrotaskOutcome = "yielded" | "aborted" | "deadline";

export interface InterruptibleMacrotaskOptions {
    signal?: AbortSignal;
    absoluteDeadlineMs?: number;
    now: () => number;
    yieldMacrotask?: () => Promise<void>;
}

/**
 * Runs a fixed parallel group under one derived signal. A rejected branch
 * aborts and drains its siblings before the original rejection escapes.
 */
export async function runInterruptibleParallelGroup<T extends readonly unknown[]>(
    parentSignal: AbortSignal | undefined,
    createTasks: (signal: AbortSignal) => { [K in keyof T]: Promise<T[K]> },
): Promise<T> {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

    let firstError: unknown;
    let hasFirstError = false;
    try {
        const tasks = createTasks(controller.signal);
        const guarded = tasks.map((task) => Promise.resolve(task).catch((error) => {
            if (!hasFirstError) {
                hasFirstError = true;
                firstError = error;
            }
            controller.abort();
            throw error;
        }));
        const settled = await Promise.allSettled(guarded);
        const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (rejected) throw hasFirstError ? firstError : rejected.reason;
        return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value) as unknown as T;
    } finally {
        parentSignal?.removeEventListener("abort", abortFromParent);
        controller.abort();
    }
}

/**
 * Yields through a real macrotask without allowing a throttled scheduler to
 * hide work after the parent invocation or absolute deadline has ended.
 */
export function waitForInterruptibleMacrotask(
    options: InterruptibleMacrotaskOptions,
): Promise<InterruptibleMacrotaskOutcome> {
    const yieldMacrotask = options.yieldMacrotask ?? defaultMacrotask;
    return new Promise<InterruptibleMacrotaskOutcome>((resolve, reject) => {
        let settled = false;
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
            if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
            options.signal?.removeEventListener("abort", onAbort);
        };
        const settle = (outcome: InterruptibleMacrotaskOutcome) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(outcome);
        };
        const fail = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onAbort = () => settle("aborted");
        const scheduleDeadline = () => {
            if (options.absoluteDeadlineMs === undefined) return;
            const remainingMs = options.absoluteDeadlineMs - options.now();
            if (remainingMs <= 0) {
                settle("deadline");
                return;
            }
            if (!Number.isFinite(remainingMs)) return;
            // Clamp only exceptionally distant deadlines; recheck the injected
            // clock before settling so clock adjustments retain absolute-time
            // semantics.
            deadlineTimer = setTimeout(() => {
                deadlineTimer = undefined;
                if (
                    options.absoluteDeadlineMs !== undefined
                    && options.now() >= options.absoluteDeadlineMs
                ) settle("deadline");
                else scheduleDeadline();
            }, Math.min(remainingMs, 0x7fffffff));
        };

        if (options.signal?.aborted) {
            settle("aborted");
            return;
        }
        if (
            options.absoluteDeadlineMs !== undefined
            && options.now() >= options.absoluteDeadlineMs
        ) {
            settle("deadline");
            return;
        }
        options.signal?.addEventListener("abort", onAbort, { once: true });
        // Close the check-to-listen race if the signal aborted synchronously.
        if (options.signal?.aborted) {
            settle("aborted");
            return;
        }
        scheduleDeadline();

        try {
            void yieldMacrotask().then(
                () => settle("yielded"),
                (error) => fail(error),
            );
        } catch (error) {
            fail(error);
        }
    });
}

function defaultMacrotask(): Promise<void> {
    const taskScheduler = (globalThis as typeof globalThis & {
        scheduler?: {
            postTask?: (
                callback: () => void,
                options?: { priority?: "user-blocking" | "user-visible" | "background" },
            ) => Promise<void>;
        };
    }).scheduler;
    if (typeof taskScheduler?.postTask === "function") {
        return taskScheduler.postTask(() => undefined, { priority: "user-visible" });
    }
    if (typeof MessageChannel !== "undefined") {
        return new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                resolve();
            };
            channel.port2.postMessage(undefined);
        });
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
}

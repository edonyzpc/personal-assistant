import {
    clearPlatformTimeout,
    setPlatformTimeout,
} from "../platform-dom";

export const MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS = 10_000;

export class MemoryExternalOperationTimeoutError extends Error {
    constructor(readonly operation: string, readonly timeoutMs: number) {
        super(`Memory external operation ${operation} timed out after ${timeoutMs}ms.`);
        this.name = "MemoryExternalOperationTimeoutError";
    }
}

/**
 * Bounds an external store operation without cancelling its underlying work.
 * Callers retain their existing idempotency/CAS guards for a late completion,
 * while the authoritative Memory state remains pending and retryable.
 */
export function withMemoryExternalOperationTimeout<T>(
    operation: string,
    task: () => Promise<T>,
    timeoutMs = MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS,
): Promise<T> {
    const boundedTimeoutMs = Math.max(1, timeoutMs);
    return new Promise<T>((resolve, reject) => {
        const timer = setPlatformTimeout(() => {
            reject(new MemoryExternalOperationTimeoutError(operation, boundedTimeoutMs));
        }, boundedTimeoutMs);
        Promise.resolve().then(task).then(
            (value) => {
                clearPlatformTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearPlatformTimeout(timer);
                reject(error);
            },
        );
    });
}

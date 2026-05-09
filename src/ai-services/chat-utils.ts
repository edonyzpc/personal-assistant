export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
        return true;
    }
    return error instanceof Error && error.name === "AbortError";
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw createAbortError();
    }
}

export function createAbortError(): Error {
    if (typeof DOMException !== "undefined") {
        return new DOMException("Aborted", "AbortError");
    }
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
}

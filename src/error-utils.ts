export function toError(error: unknown): Error {
    if (error instanceof Error) return error;
    if (!error || typeof error !== "object") return new Error(String(error));

    const record = error as { message?: unknown; name?: unknown; code?: unknown; cause?: unknown };
    const normalized = new Error(typeof record.message === "string" ? record.message : String(error));
    if (typeof record.name === "string") normalized.name = record.name;
    if ("code" in record) {
        (normalized as Error & { code?: unknown }).code = record.code;
    }
    if ("cause" in record) {
        (normalized as Error & { cause?: unknown }).cause = record.cause;
    } else {
        (normalized as Error & { cause?: unknown }).cause = error;
    }
    return normalized;
}

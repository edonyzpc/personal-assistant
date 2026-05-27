export function getErrorType(error: unknown): string {
    return error instanceof Error ? error.name || "Error" : typeof error;
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// JSON.stringify with object key sort, used to derive stable cache/dedup keys from
// tool-call inputs regardless of provider key ordering.
export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

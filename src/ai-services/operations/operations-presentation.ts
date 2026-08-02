import type {
    FrontmatterUpdateInput,
    PreparedOperation,
    VaultAppendInput,
} from "./types";

const OPERATIONS_PREVIEW_MAX_CHARS = 1_600;

export interface OperationsPreviewFormatter {
    formatFrontmatterSet?: (key: string, serializedValue: string) => string;
    formatFrontmatterRemove?: (key: string) => string;
}

/** Shared, content-bounded preview used by every Operations confirmation UI. */
export function formatOperationsPreview(
    operation: PreparedOperation,
    formatter: OperationsPreviewFormatter = {},
): string {
    if (operation.name === "vault_create") {
        return operation.expectedAfter;
    }
    if (operation.name === "vault_append") {
        return `+ ${(operation.input as VaultAppendInput).content}`;
    }
    if (operation.name === "frontmatter_update") {
        const input = operation.input as FrontmatterUpdateInput;
        const formatSet = formatter.formatFrontmatterSet
            ?? ((key: string, value: string) => `Set ${key}: ${value}`);
        const formatRemove = formatter.formatFrontmatterRemove
            ?? ((key: string) => `Remove ${key}`);
        const lines = [
            ...Object.entries(input.set ?? {}).map(([key, value]) => formatSet(key, JSON.stringify(value))),
            ...(input.delete ?? []).map((key) => formatRemove(key)),
        ];
        return lines.join("\n");
    }
    return formatOperationsBeforeAfterPreview(
        operation.expectedBefore ?? "",
        operation.expectedAfter,
    );
}

function formatOperationsBeforeAfterPreview(before: string, after: string): string {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (
        suffix < before.length - prefix
        && suffix < after.length - prefix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) suffix += 1;
    const contextChars = 220;
    const excerpt = (value: string) => {
        const start = Math.max(0, prefix - contextChars);
        const changedEnd = value.length - suffix;
        const end = Math.min(value.length, changedEnd + contextChars);
        return `${start > 0 ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`;
    };
    return truncateOperationsPreview([
        "Before",
        excerpt(before),
        "",
        "After",
        excerpt(after),
    ].join("\n"));
}

function truncateOperationsPreview(value: string): string {
    if (value.length <= OPERATIONS_PREVIEW_MAX_CHARS) return value;
    return `${value.slice(0, OPERATIONS_PREVIEW_MAX_CHARS)}\n…`;
}

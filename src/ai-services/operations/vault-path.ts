import { FORBIDDEN_DOTFOLDER_SEGMENTS, foldForDotfolderCheck } from "../../shared/path-spoof-patterns";
import { validateTargetConfinementSync } from "../write-action-framework/target-confinement";

export class OperationsPathError extends Error {
    readonly code = "path_rejected";

    constructor(readonly reason: string, message?: string) {
        super(message ?? `Vault path rejected: ${reason}.`);
        this.name = "OperationsPathError";
    }
}

/**
 * Validate a model-provided vault-wide Markdown target using the existing WAF
 * confinement primitives. The first segment is used as the allowlisted root
 * because Operations Step 2 deliberately supports the whole vault; WAF still
 * owns normalization, traversal, spoof, extension, and length checks.
 */
export function validateOperationsVaultPath(candidate: unknown): string {
    if (typeof candidate !== "string") throw new OperationsPathError("empty_path");
    const preNormalized = candidate
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/+/g, "/");
    const firstSegment = preNormalized.split("/")[0] ?? "";
    const result = validateTargetConfinementSync(candidate, {
        allowedRoots: [firstSegment],
        allowedExtensions: [".md"],
        maxPathLength: 200,
    });
    if (!result.ok) throw new OperationsPathError(result.reason, pathErrorMessage(result.reason));

    const segments = result.normalizedPath.split("/");
    if (segments.some((segment) => segment === "." || segment.length === 0)) {
        throw new OperationsPathError("ambiguous_segment", "Vault path contains an ambiguous segment.");
    }
    for (const segment of segments) {
        if (FORBIDDEN_DOTFOLDER_SEGMENTS.has(foldForDotfolderCheck(segment))) {
            throw new OperationsPathError("forbidden_dotfolder", "Vault path targets a protected directory.");
        }
    }
    return result.normalizedPath;
}

export function parentVaultPath(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash);
}

function pathErrorMessage(reason: string): string {
    switch (reason) {
        case "absolute_path": return "Absolute filesystem paths are not allowed.";
        case "drive_letter": return "Drive-letter paths are not allowed.";
        case "parent_traversal": return "Parent traversal is not allowed.";
        case "control_char":
        case "invisible_chars": return "Vault path contains unsafe invisible characters.";
        case "trailing_dot_or_space": return "Vault path segments cannot end with a dot or space.";
        case "forbidden_dotfolder": return "Vault path targets a protected directory.";
        case "bad_extension": return "Operations targets must be Markdown (.md) notes.";
        case "path_too_long": return "Vault path exceeds 200 characters.";
        default: return "Vault path is not allowed.";
    }
}

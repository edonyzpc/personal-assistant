export type GhostExportErrorCode =
    | "missing-guard"
    | "guard-revoked"
    | "source-not-found"
    | "source-changed"
    | "embed-not-found"
    | "embed-subpath-not-found"
    | "embed-cycle"
    | "frontmatter-invalid"
    | "field-invalid"
    | "unsupported-syntax"
    | "unknown-executable-content"
    | "resource-not-found"
    | "comment-unclosed"
    | "cover-ambiguous"
    | "recipe-region-conflict";

export class GhostExportError extends Error {
    constructor(
        readonly code: GhostExportErrorCode,
        message: string,
        readonly path?: string,
        readonly line?: number,
    ) {
        super(message);
        this.name = "GhostExportError";
    }
}

export function exportErrorLocation(error: unknown): { code?: string; path?: string; line?: number } {
    return error instanceof GhostExportError
        ? { code: error.code, path: error.path, line: error.line }
        : {};
}

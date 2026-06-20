/**
 * Append Action Capability — Write Action Framework Phase 3 (SPEC-C1).
 *
 * Implements "append-to-current-note" action family: appends LLM-generated
 * content to the end of the currently active note. Unlike create-file, the
 * target comes from `app.workspace.getActiveFile()` (NOT from the LLM),
 * eliminating the path-injection surface.
 *
 * Key safety properties:
 *   - Target is the active file (user-selected, not LLM-selected)
 *   - Content size capped at 50,000 characters
 *   - Boundary marker (`<!-- pa-appended ISO-timestamp -->`) delineates
 *     user-authored vs. PA-appended content for auditing and rollback
 *   - Rollback restores original content verbatim via `vault.modify()`
 *   - Stale-reread mode B (content-hash) detects concurrent edits between
 *     preview and execute
 */

import { TFile, type App } from "obsidian";

import type { PreviewSpec } from "./types";

/** Maximum characters allowed in a single append payload. */
export const APPEND_CONTENT_MAX_CHARS = 50_000;

/** Number of tail lines from existing content shown in preview context. */
const APPEND_CONTEXT_TAIL_LINES = 5;

export interface AppendActionInput {
    content: string;
    activeFile: TFile;
}

export interface AppendActionResult {
    targetPath: string;
    appendedContent: string;
    originalContent: string;
    boundaryMarker: string;
}

/**
 * Build a boundary marker for the append operation. The ISO timestamp
 * anchors each append for auditing and visual delineation when a note
 * accumulates multiple appends.
 */
export function buildBoundaryMarker(timestamp: Date = new Date()): string {
    return `<!-- pa-appended ${timestamp.toISOString()} -->`;
}

/**
 * Build a {@link PreviewSpec} for the append-to-current-note action.
 *
 * Pure function — no side effects, no FS access. Reads only the input
 * and the file's existing content (passed externally) to produce the
 * preview spec for the modal.
 */
export function buildAppendPreview(
    input: AppendActionInput,
    existingContent: string,
): PreviewSpec {
    const { content, activeFile } = input;
    const targetPath = activeFile.path;
    const lastSlash = targetPath.lastIndexOf("/");
    const folder = lastSlash > 0 ? targetPath.substring(0, lastSlash) : "";
    const filename = lastSlash >= 0 ? targetPath.substring(lastSlash + 1) : targetPath;

    const riskNotes: string[] = [];
    if (content.length > APPEND_CONTENT_MAX_CHARS) {
        riskNotes.push(
            `Content exceeds the ${APPEND_CONTENT_MAX_CHARS.toLocaleString()} character limit (${content.length.toLocaleString()} chars).`,
        );
    }

    const existingLines = existingContent.split("\n");
    const tailLines = existingLines.slice(-APPEND_CONTEXT_TAIL_LINES);

    const contentBytes = new TextEncoder().encode(content).byteLength;

    return {
        operationType: "append-to-current-note",
        actionFamily: "append-to-current-note",
        capabilityId: "append_to_current_note",
        target: {
            kind: "vault-path",
            displayPath: targetPath,
            folder,
            filename,
        },
        contentPreview: {
            format: "markdown",
            body: content,
            byteSize: contentBytes,
        },
        impact: {
            usesAiProvider: false,
            usesAiCredits: false,
            affectsExternalState: false,
        },
        riskNotes,
        confirmCopy: {
            confirmLabel: "Append",
            cancelLabel: "Cancel",
        },
        appendContext: {
            existingTailLines: tailLines,
            insertionPoint: "end-of-file",
        },
    };
}

/**
 * Execute the append write: read current content, validate file state,
 * compute boundary marker, append with separator, and write back.
 *
 * Returns the result with original content for rollback support.
 *
 * @throws When the file no longer exists or content exceeds the size limit.
 */
export async function executeAppendWrite(
    input: AppendActionInput,
    app: App,
    nowFactory: () => Date = () => new Date(),
): Promise<AppendActionResult> {
    const { content, activeFile } = input;

    if (content.length > APPEND_CONTENT_MAX_CHARS) {
        const err = new Error(
            `Append content exceeds ${APPEND_CONTENT_MAX_CHARS.toLocaleString()} character limit (${content.length.toLocaleString()} chars).`,
        );
        (err as Error & { skipWriteRollback?: boolean }).skipWriteRollback = true;
        throw err;
    }

    // Re-resolve the file to confirm it still exists in the vault.
    const file = app.vault.getAbstractFileByPath(activeFile.path);
    if (!file) {
        const err = new Error(
            `Target file no longer exists: ${activeFile.path}`,
        );
        (err as Error & { skipWriteRollback?: boolean }).skipWriteRollback = true;
        throw err;
    }

    const originalContent = await app.vault.read(activeFile);
    const boundaryMarker = buildBoundaryMarker(nowFactory());
    const separator = "\n\n";
    const newContent = originalContent + separator + boundaryMarker + "\n" + content;

    await app.vault.modify(activeFile, newContent);

    return {
        targetPath: activeFile.path,
        appendedContent: content,
        originalContent,
        boundaryMarker,
    };
}

/**
 * Rollback an append operation by restoring the original content.
 * Silently succeeds if the file no longer exists (already cleaned up).
 */
export async function rollbackAppend(
    result: AppendActionResult,
    app: App,
): Promise<void> {
    const file = app.vault.getAbstractFileByPath(result.targetPath);
    if (!file) {
        // File was removed externally — nothing to rollback.
        return;
    }
    if (!(file instanceof TFile)) {
        return;
    }
    await app.vault.modify(file, result.originalContent);
}

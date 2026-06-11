/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — ReviewNoteWriter (Scenario 4: Periodic Summary).
 *
 * Writes a generated review note to the vault. Uses `vault.adapter.write`
 * (R3 compatibility — bypass `vault.modify` for Linter plugin compat, D029).
 *
 * Design references:
 *  - `docs/pagelet-v2-sdd-guide.md` §8 (Review Note Output)
 *  - `docs/pagelet-v2-product-design.md` §Write Boundary (D025, D030)
 *  - `src/pagelet/pa-review-file-io.ts` — v1 IO patterns:
 *    - `ensureFolder` for recursive folder creation
 *    - `mintNonCollidingReviewNotePath` for collision handling
 *    - `vault.adapter.write` (NOT `vault.create` or `vault.modify`)
 *
 * What this file does NOT do:
 *  - Generate the note content — that is `ReviewNoteGenerator`'s job.
 *  - Enforce Write Action Framework gates — the caller (orchestrator /
 *    runtime) is responsible for routing through `ActionExecutor` when the
 *    framework is active.
 *  - Manage the self-write registry — the caller injects `markSelfWrite`
 *    if needed (mirrors `pa-review-file-io.ts`'s `WriteReviewNoteInput`).
 */

import { normalizePath } from "obsidian";
import type { App } from "obsidian";

import type { GeneratedReviewNote, WriteResult } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Max collision suffix attempts before falling back to a timestamp suffix.
 * Matches `pa-review-file-io.ts:MAX_COLLISION_SUFFIX` — same rationale:
 * after 99 attempts we're in pathological territory and should fallback
 * to an HHMMSS suffix.
 */
const MAX_COLLISION_SUFFIX = 99;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Writes generated review notes to the vault.
 *
 * Stateless — each `write()` call is independent. The `App` reference is
 * used only for `vault.adapter.*` calls; no LLM or network access occurs.
 */
export class ReviewNoteWriter {
    constructor(private readonly app: App) {}

    /**
     * Write a generated review note to the vault.
     *
     * IO flow (mirrors SDD §5.2 R3 pattern from v1):
     *  1. Ensure target folder exists (recursive `mkdir` for missing segments)
     *  2. Check for path collision — mint a non-colliding path if needed
     *  3. Write via `vault.adapter.write` (NOT `vault.create` or `vault.modify`)
     *  4. Return the actual file path
     *
     * @param note - The generated review note to write.
     * @param markSelfWrite - Optional hook to register the path as a self-write
     *   (prevents modify-event listener from re-triggering). Called BEFORE the
     *   actual write, mirroring `pa-review-file-io.ts` timing.
     */
    async write(
        note: GeneratedReviewNote,
        markSelfWrite?: (path: string) => void,
    ): Promise<WriteResult> {
        try {
            // 1. Ensure target folder exists
            await this.ensureFolder(note.targetFolder);

            // 2. Resolve a non-colliding path
            const finalPath = await this.exists(note.targetPath)
                ? await this.mintNonCollidingPath(note.targetPath)
                : normalizePath(note.targetPath);

            // 3. Self-write registration (before actual write — R3 timing)
            markSelfWrite?.(finalPath);

            // 4. Write via adapter (R3 — bypasses Linter plugin, D029)
            await this.app.vault.adapter.write(finalPath, note.markdown);

            return {
                success: true,
                filePath: finalPath,
            };
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * Check if a vault-relative path already exists.
     *
     * Used by the preview flow to warn the user before confirmation if the
     * target would collide with an existing note.
     */
    async exists(path: string): Promise<boolean> {
        return this.app.vault.adapter.exists(normalizePath(path));
    }

    /**
     * Mint a non-colliding path by appending `-2`, `-3`, ... suffixes.
     *
     * Follows the same collision strategy as `pa-review-file-io.ts`:
     *  - Try `-2`, `-3`, ... up to `-{MAX_COLLISION_SUFFIX + 1}`
     *  - Fall back to an HHMMSS timestamp suffix after exhausting numeric
     *    suffixes (pathological-territory safeguard)
     *
     * @param basePath - The original vault-relative path that collides.
     * @returns A non-colliding vault-relative path.
     */
    async mintNonCollidingPath(basePath: string): Promise<string> {
        const normalized = normalizePath(basePath);
        const ext = extFromPath(normalized);
        const stem = ext
            ? normalized.slice(0, normalized.length - ext.length)
            : normalized;

        // Try numeric suffixes: stem-2.md, stem-3.md, ...
        for (let i = 2; i <= MAX_COLLISION_SUFFIX + 1; i++) {
            const candidate = normalizePath(`${stem}-${i}${ext}`);
            if (!(await this.app.vault.adapter.exists(candidate))) {
                return candidate;
            }
        }

        // Fallback: append HHMMSS timestamp
        const now = new Date();
        const hh = String(now.getUTCHours()).padStart(2, "0");
        const mm = String(now.getUTCMinutes()).padStart(2, "0");
        const ss = String(now.getUTCSeconds()).padStart(2, "0");
        return normalizePath(`${stem}-${hh}${mm}${ss}${ext}`);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Recursively ensure a folder path exists, creating missing segments.
     *
     * Mirrors `pa-review-file-io.ts:ensureFolder` — walks one segment at a
     * time so nested paths like `reviews/2026/weekly` are created correctly.
     */
    private async ensureFolder(folder: string): Promise<void> {
        const parts = normalizePath(folder).split("/").filter(Boolean);
        let current = "";
        for (const segment of parts) {
            current = current ? `${current}/${segment}` : segment;
            if (!(await this.app.vault.adapter.exists(current))) {
                await this.app.vault.createFolder(current);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Extract the file extension (including the dot) from a path.
 * Returns an empty string if no extension is found.
 */
function extFromPath(path: string): string {
    const lastSlash = path.lastIndexOf("/");
    const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) return "";
    return fileName.slice(dotIndex);
}

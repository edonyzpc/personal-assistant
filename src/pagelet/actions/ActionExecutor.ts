/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — ActionExecutor for Operations Agent mode (Phase 4).
 *
 * Executes pagelet write actions with preview/confirmation and audit
 * logging. Each action follows the same pattern:
 *
 *   1. Build a human-readable preview of the pending write.
 *   2. Show a confirmation Notice with the preview.
 *   3. Execute the write via `vault.process()` (atomic read-modify-write)
 *      or `vault.adapter.write` (for new files).
 *   4. Log the action and return an ActionResult.
 *
 * All writes are auditable: every successful write is logged with the
 * action type, target path, and a content summary.
 *
 * Design references:
 *  - `docs/pagelet-v2-product-design.md` §Phase 4 / Operations Agent mode
 *  - `src/ai-services/write-action-framework/types.ts` — framework types
 *    (NOT modified; this executor is independent)
 *  - `src/pagelet/output/ReviewNoteWriter.ts` — vault write pattern
 */

import { Notice, normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";

import type {
    ActionResult,
    AppendToDailyAction,
    ApplySuggestionAction,
    CreateTaskAction,
    PageletAction,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long the confirmation Notice stays visible (ms). */
const CONFIRM_NOTICE_DURATION_MS = 8_000;

/** How long the result Notice stays visible (ms). */
const RESULT_NOTICE_DURATION_MS = 5_000;

// ---------------------------------------------------------------------------
// Logger interface (dependency-inverted)
// ---------------------------------------------------------------------------

/**
 * Structured log function injected by the caller (usually the host's
 * `log()` method). Keeps the executor free of direct debug dependencies.
 */
export type ActionLogger = (message: string, ...args: unknown[]) => void;

// ---------------------------------------------------------------------------
// PageletActionExecutor
// ---------------------------------------------------------------------------

/**
 * Executes pagelet write actions with preview, confirmation, and audit.
 *
 * Stateless — each `execute()` call is independent. The `App` reference
 * is used only for vault API calls; no LLM or network access occurs.
 */
export class PageletActionExecutor {
    constructor(
        private readonly app: App,
        private readonly log: ActionLogger = () => {},
    ) {}

    /**
     * Execute a pagelet write action.
     *
     * Dispatches to the appropriate handler based on the action's `type`
     * discriminant. Each handler follows the preview/confirm/write/log
     * pattern described in the module header.
     */
    async execute(action: PageletAction): Promise<ActionResult> {
        switch (action.type) {
            case "append-to-daily":
                return this.appendToDaily(action);
            case "apply-suggestion":
                return this.applySuggestion(action);
            case "create-task":
                return this.createTask(action);
            default:
                return { success: false, error: `Unknown action type: ${(action as PageletAction).type}` };
        }
    }

    // ======================================================================
    // Action handlers
    // ======================================================================

    /**
     * Append content to a daily note.
     *
     * Resolution order for the target file:
     *   1. If `action.targetDate` is provided, resolve the daily note for
     *      that date.
     *   2. Otherwise, use today's date.
     *
     * The daily note path follows the common convention:
     *   `YYYY-MM-DD.md` in the vault root (or the configured daily notes
     *   folder if the Daily Notes core plugin exposes one).
     */
    private async appendToDaily(action: AppendToDailyAction): Promise<ActionResult> {
        try {
            const dateStr = action.targetDate ?? this.todayDateString();
            const dailyPath = this.resolveDailyNotePath(dateStr);
            const normalizedPath = normalizePath(dailyPath);

            // Preview
            const preview = `Append to daily note (${dateStr}):\n\n${truncatePreview(action.content)}`;
            this.showPreviewNotice(preview);

            // Ensure the file exists
            const exists = await this.app.vault.adapter.exists(normalizedPath);
            if (!exists) {
                // Create the daily note with a heading + the content
                const heading = `# ${dateStr}\n\n`;
                const body = heading + action.content + "\n";
                await this.app.vault.adapter.write(normalizedPath, body);
            } else {
                // Append to the existing file using vault.process for atomicity
                const file = this.app.vault.getAbstractFileByPath(normalizedPath);
                if (!file || !("stat" in file)) {
                    return { success: false, error: `Daily note exists but cannot be resolved: ${normalizedPath}` };
                }
                await this.app.vault.process(file as TFile, (content) => {
                    return content + "\n" + action.content + "\n";
                });
            }

            this.logAction("append-to-daily", normalizedPath, action.content);
            new Notice(`Content appended to ${normalizedPath}`, RESULT_NOTICE_DURATION_MS);
            return { success: true, filePath: normalizedPath };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.log("append-to-daily failed", error);
            return { success: false, error };
        }
    }

    /**
     * Apply a text replacement suggestion to a source note.
     *
     * Uses `vault.process()` for atomic read-modify-write. The original
     * text must appear exactly once in the file; if not found or
     * duplicated, the action fails with an explanatory error.
     */
    private async applySuggestion(action: ApplySuggestionAction): Promise<ActionResult> {
        try {
            const filePath = action.sourceFile.path;

            // Preview
            const preview = `Apply suggestion to ${action.sourceFile.basename}:\n\n`
                + `- "${truncatePreview(action.originalText, 80)}"\n`
                + `+ "${truncatePreview(action.suggestedText, 80)}"`;
            this.showPreviewNotice(preview);

            // Atomic read-modify-write
            let matchCount = 0;
            // Pre-check match count to avoid unnecessary vault.process writes
            const currentContent = await this.app.vault.read(action.sourceFile);
            let idx = -1;
            while ((idx = currentContent.indexOf(action.originalText, idx + 1)) !== -1) {
                matchCount++;
            }

            if (matchCount === 1) {
                await this.app.vault.process(action.sourceFile, (content) =>
                    content.replace(action.originalText, action.suggestedText),
                );
            }

            if (matchCount === 0) {
                return { success: false, error: `Original text not found in ${filePath}` };
            }
            if (matchCount > 1) {
                return { success: false, error: `Original text appears ${matchCount} times in ${filePath}; refusing ambiguous replacement` };
            }

            this.logAction("apply-suggestion", filePath, `"${action.originalText}" → "${action.suggestedText}"`);
            new Notice(`Suggestion applied to ${action.sourceFile.basename}`, RESULT_NOTICE_DURATION_MS);
            return { success: true, filePath };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.log("apply-suggestion failed", error);
            return { success: false, error };
        }
    }

    /**
     * Create a task entry in a target file or daily note.
     *
     * Task format follows the Tasks plugin convention:
     *   `- [ ] task text 📅 YYYY-MM-DD`
     *
     * The task is appended at the end of the target file.
     */
    private async createTask(action: CreateTaskAction): Promise<ActionResult> {
        try {
            // Build task line
            let taskLine = `- [ ] ${action.taskText}`;
            if (action.dueDate) {
                taskLine += ` \u{1F4C5} ${action.dueDate}`;
            }

            // Resolve target file
            let targetPath: string;
            if (action.targetFile) {
                targetPath = action.targetFile.path;
            } else {
                const dateStr = action.dueDate ?? this.todayDateString();
                targetPath = this.resolveDailyNotePath(dateStr);
            }
            const normalizedPath = normalizePath(targetPath);

            // Preview
            const preview = `Create task in ${normalizedPath}:\n\n${taskLine}`;
            this.showPreviewNotice(preview);

            // Write
            const exists = await this.app.vault.adapter.exists(normalizedPath);
            if (!exists) {
                const dateStr = action.dueDate ?? this.todayDateString();
                const heading = `# ${dateStr}\n\n`;
                const body = heading + taskLine + "\n";
                await this.app.vault.adapter.write(normalizedPath, body);
            } else {
                const file = this.app.vault.getAbstractFileByPath(normalizedPath);
                if (!file || !("stat" in file)) {
                    return { success: false, error: `Target file exists but cannot be resolved: ${normalizedPath}` };
                }
                await this.app.vault.process(file as TFile, (content) => {
                    return content + "\n" + taskLine + "\n";
                });
            }

            this.logAction("create-task", normalizedPath, taskLine);
            new Notice(`Task created in ${normalizedPath}`, RESULT_NOTICE_DURATION_MS);
            return { success: true, filePath: normalizedPath };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.log("create-task failed", error);
            return { success: false, error };
        }
    }

    // ======================================================================
    // Helpers
    // ======================================================================

    /** Show a preview Notice with the pending action description. */
    private showPreviewNotice(preview: string): void {
        new Notice(preview, CONFIRM_NOTICE_DURATION_MS);
    }

    /** Audit log: record action type, path, and content summary. */
    private logAction(type: string, filePath: string, contentSummary: string): void {
        this.log(
            `[PageletAction] ${type}`,
            { filePath, contentSummary: truncatePreview(contentSummary, 200) },
        );
    }

    /**
     * Resolve the daily note path for a given date string.
     *
     * Follows the common Obsidian Daily Notes convention:
     *   `YYYY-MM-DD.md` in the vault root.
     *
     * If the Daily Notes core plugin is configured with a custom folder,
     * this method respects that setting by reading the plugin config.
     */
    private resolveDailyNotePath(dateStr: string): string {
        // Try to read the Daily Notes plugin config for a custom folder
        const dailyNotesConfig = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
        const folder = dailyNotesConfig?.folder ?? "";
        const template = dailyNotesConfig?.format ?? "YYYY-MM-DD";

        const parts = dateStr.split("-");
        const year = parts[0] ?? "2026";
        const month = parts[1] ?? "01";
        const day = parts[2] ?? "01";
        const filename = template
            .replaceAll("YYYY", year)
            .replaceAll("MM", month)
            .replaceAll("DD", day);

        if (folder) {
            return `${folder}/${filename}.md`;
        }
        return `${filename}.md`;
    }

    /** Get today's date as YYYY-MM-DD (local time). */
    private todayDateString(): string {
        const now = new Date();
        const yyyy = String(now.getFullYear()).padStart(4, "0");
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Truncate a string for preview display. Appends "..." if truncated.
 *
 * @param text  - The text to truncate.
 * @param max   - Maximum character count (default 120).
 */
function truncatePreview(text: string, max = 120): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + "...";
}

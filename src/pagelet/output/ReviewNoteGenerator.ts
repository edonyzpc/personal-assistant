/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — ReviewNoteGenerator (Scenario 4: Periodic Summary).
 *
 * Generates a complete review note from scope-resolved files. The generation
 * pipeline is:
 *   1. Read file contents via `vault.cachedRead`
 *   2. Build a structured prompt with clear delimiters
 *   3. Call the injected `GenerateCallback` (decoupled from LLM provider)
 *   4. Parse the AI response and assemble frontmatter + body
 *
 * Design references:
 *  - `docs/pagelet-v2-product-design.md` §Periodic Summary Output (D035)
 *  - `docs/pagelet-v2-sdd-guide.md` §8 (Review Note Output)
 *  - `docs/pagelet-v2-product-design.md` §File Naming and Location
 *  - `src/pagelet/pa-review-file-io.ts` — v1 patterns (path resolution,
 *    frontmatter serialization, date formatting)
 *
 * What this file does NOT do:
 *  - Construct or manage the LLM model — the caller injects a
 *    `GenerateCallback` so the output module stays decoupled.
 *  - Write to the vault — that is `ReviewNoteWriter`'s responsibility.
 *  - Enforce cost / rate limits — those gates run upstream before the
 *    caller invokes `generate()`.
 */

import { normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";

import {
    formatPageletDate,
    formatPageletIsoTimestamp,
    resolveReviewsFolderPath,
} from "../pa-review-file-io";
import type { PageletReviewFileIOSettings } from "../pa-review-file-io";

import type {
    GenerateCallback,
    GeneratedReviewNote,
    PeriodicSummaryInput,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Filename infix for periodic summary notes. Distinct from v1's per-note
 * `pagelet-review` infix (SDD §8).
 */
const PERIODIC_SUMMARY_FILENAME_INFIXES: Record<string, string> = {
    "3": "pagelet-3d-review",
    "7": "pagelet-weekly-review",
    "14": "pagelet-biweekly-review",
};

function getFilenameInfix(scopeDays: number): string {
    return PERIODIC_SUMMARY_FILENAME_INFIXES[String(scopeDays)] ?? "pagelet-periodic-review";
}

const MAX_FILES_FOR_SUMMARY = 50;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a complete periodic summary review note from scope-resolved files.
 *
 * Stateless — each `generate()` call is independent. The `App` reference is
 * used only for `vault.cachedRead`; no writes or side-effects occur.
 */
export class ReviewNoteGenerator {
    constructor(private readonly app: App) {}

    /**
     * Generate a periodic summary review note.
     *
     * @param input       - Files + time range resolved by the scope module.
     * @param settings    - Settings slice (provides `reviewsFolder`).
     * @param generateCb  - AI generation callback (injected by caller).
     * @param tokenBudget - Input/output token budget for the AI call.
     * @param dateOverride - Optional date override for deterministic filenames.
     * @returns A `GeneratedReviewNote` ready for preview and write.
     */
    async generate(
        input: PeriodicSummaryInput,
        settings: PageletReviewFileIOSettings,
        generateCb: GenerateCallback,
        tokenBudget: { input: number; output: number },
        dateOverride?: Date,
    ): Promise<GeneratedReviewNote> {
        if (input.files.length === 0) {
            throw new Error("No files in scope for periodic summary generation.");
        }

        const date = dateOverride ?? new Date();
        const filesToRead = input.files.slice(0, MAX_FILES_FOR_SUMMARY);

        // 1. Read file contents (capped to avoid unbounded memory usage)
        const noteContents = await this.readFileContents(filesToRead);

        // 2. Build prompt
        const sources = noteContents.map((n) => `[[${stripExtension(n.path)}]]`);
        const prompt = buildPeriodicSummaryPrompt(
            input.rangeDescription,
            input.scopeDays,
            noteContents,
        );

        // 3. Call AI
        const aiResult = await generateCb(prompt, noteContents, tokenBudget);

        // 4. Assemble the note
        const targetFolder = resolveReviewsFolderPath(settings.reviewsFolder);
        const fileName = `${getFilenameInfix(input.scopeDays)}-${formatPageletDate(date)}.md`;
        const targetPath = normalizePath(`${targetFolder}/${fileName}`);

        const frontmatter = serializePeriodicSummaryFrontmatter({
            range: input.rangeDescription,
            generatedAt: formatPageletIsoTimestamp(date),
            sources,
            costUsd: estimateCostUsd(aiResult.tokenCost),
        });

        const body = normalizeAiBody(aiResult.text, date);
        const markdown = `${frontmatter}\n\n${body}`.trimEnd() + "\n";

        return {
            markdown,
            fileName,
            targetFolder,
            targetPath,
            sources,
            tokenCost: aiResult.tokenCost,
        };
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Read all file contents via `cachedRead` (non-blocking, uses Obsidian's
     * metadata cache when available). Skips files that fail to read (e.g.,
     * deleted between scope resolution and generation).
     */
    private async readFileContents(
        files: TFile[],
    ): Promise<Array<{ path: string; content: string }>> {
        const results: Array<{ path: string; content: string }> = [];
        for (const file of files) {
            try {
                const content = await this.app.vault.cachedRead(file);
                results.push({ path: file.path, content });
            } catch {
                // File may have been deleted or renamed between scope
                // resolution and generation — skip silently. The AI prompt
                // will simply have fewer sources.
            }
        }
        return results;
    }
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build the prompt for periodic summary generation.
 *
 * The prompt structure:
 *  - System-level instruction (role + output format)
 *  - Note contents with clear delimiters
 *  - Output structure requirements (matching product design §8)
 */
function buildPeriodicSummaryPrompt(
    rangeDescription: string,
    scopeDays: number,
    noteContents: Array<{ path: string; content: string }>,
): string {
    const noteBlocks = noteContents.map((n, i) => [
        `--- NOTE ${i + 1}: ${n.path} ---`,
        n.content,
        `--- END NOTE ${i + 1} ---`,
    ].join("\n")).join("\n\n");

    return [
        "You are Pagelet, a quiet reviewer for a user's Obsidian vault.",
        `The user wants a periodic summary of their notes from the past ${scopeDays} days (${rangeDescription}).`,
        `There are ${noteContents.length} notes in scope.`,
        "",
        "Generate a structured review note in Markdown with the following sections:",
        "",
        "## Summary",
        "A concise overview of the key themes and activities across all notes.",
        "",
        "## Insights",
        "Key insights discovered across notes. Each insight should reference its source(s) using [[wikilink]] syntax.",
        "",
        "## Possible next actions",
        "Actionable next steps the user might consider, derived from the notes.",
        "",
        "## Research gaps",
        "Topics mentioned but not fully explored or cited. Mark as 'possible thread' if evidence is thin.",
        "",
        "## Related notes",
        "Notes that are related to each other, with a brief description of the connection.",
        "Format: - [[note-name]] - description",
        "",
        "## Sources",
        "List all source notes referenced.",
        "Format: - [[note-name]]",
        "",
        "RULES:",
        "- Write in the same language as the majority of the notes.",
        "- Reference source notes using [[wikilink]] syntax (without .md extension).",
        "- Keep the summary concise but comprehensive.",
        "- Do NOT wrap the output in code fences.",
        "- Do NOT include frontmatter — only the body sections listed above.",
        "- Start directly with ## Summary.",
        "",
        "Here are the notes:",
        "",
        noteBlocks,
    ].join("\n");
}

// ---------------------------------------------------------------------------
// Frontmatter serialization
// ---------------------------------------------------------------------------

interface PeriodicSummaryFrontmatterInput {
    range: string;
    generatedAt: string;
    sources: string[];
    costUsd?: number;
}

/**
 * Hand-rolled YAML frontmatter for periodic summary notes.
 *
 * The shape is intentionally different from v1's `PageletReviewMetadata` —
 * periodic summaries have `range` and `sources` array fields that the v1
 * schema does not support. A shared schema may emerge in a future version;
 * for now, keeping them separate avoids coupling the two pipelines.
 *
 * Quoting rules mirror `pa-review-file-io.ts:serializeFrontmatter`:
 *  - strings → JSON-encoded (double-quoted)
 *  - numbers → bare
 *  - booleans → bare
 *  - arrays → YAML flow style `["a", "b"]`
 */
function serializePeriodicSummaryFrontmatter(
    input: PeriodicSummaryFrontmatterInput,
): string {
    const lines: string[] = ["---"];
    lines.push("pagelet: true");
    lines.push(`range: ${JSON.stringify(input.range)}`);
    lines.push(`generated_at: ${JSON.stringify(input.generatedAt)}`);

    // Sources as YAML flow sequence — matches the product design frontmatter
    // sample: `sources: ["[[note-1]]", "[[note-2]]"]`
    const sourcesJson = input.sources.map((s) => JSON.stringify(s));
    lines.push(`sources: [${sourcesJson.join(", ")}]`);

    if (typeof input.costUsd === "number" && Number.isFinite(input.costUsd)) {
        lines.push(`pagelet_cost_usd: ${input.costUsd}`);
    }

    lines.push("---");
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Body normalization
// ---------------------------------------------------------------------------

/**
 * Normalize the AI-generated body:
 *  - Strip code fences if the AI wrapped the output despite instructions.
 *  - Ensure the heading line is present.
 */
function normalizeAiBody(text: string, date: Date): string {
    let body = text.trim();

    // Strip code fences (common LLM artefact)
    const fenced = body.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
    if (fenced) {
        body = fenced[1].trim();
    }

    // Ensure the note starts with a heading if the AI omitted it.
    const dateStr = formatPageletDate(date);
    if (!body.startsWith("#")) {
        body = `# Periodic Review — ${dateStr}\n\n${body}`;
    }

    return body;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Strip the `.md` extension from a vault path for wikilink references.
 * Obsidian wikilinks conventionally omit the extension.
 */
function stripExtension(path: string): string {
    return path.replace(/\.md$/, "");
}

/**
 * Rough cost estimate from token counts. Uses a conservative average of
 * $0.002 per 1K input tokens and $0.006 per 1K output tokens (approximate
 * mid-range for the models Pagelet targets). The exact cost depends on the
 * provider and model; this is a ballpark for the frontmatter field.
 */
function estimateCostUsd(
    tokenCost: { input: number; output: number },
): number | undefined {
    if (tokenCost.input === 0 && tokenCost.output === 0) return undefined;
    const cost = (tokenCost.input * 0.002 + tokenCost.output * 0.006) / 1000;
    return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal places
}

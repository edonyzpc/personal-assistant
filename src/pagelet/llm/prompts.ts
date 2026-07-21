/* Copyright 2023 edonyzpc */

/**
 * Pagelet — scenario-specific prompt builders.
 *
 * Each builder returns a {@link PromptBuildResult} with system prompt, user
 * prompt, and max output tokens. Note content is truncated to fit the
 * provided token budget using Pagelet's conservative token estimator.
 *
 * Design references:
 *  - `docs/product/pagelet-product-design.md` §Scenario descriptions
 *  - Reuses language-matching and JSON-output patterns from structured review
 *    `pa-review-schemas.ts`
 */

import type { PromptBuildResult } from "./types";
import { estimateTokens } from "../pa-review-cost";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a string to stay within a token budget.
 * Returns the truncated string and whether truncation occurred.
 */
function truncateToTokenBudget(text: string, tokenBudget: number): string {
    const budget = Math.max(0, Math.floor(tokenBudget));
    if (estimateTokens(text) <= budget) return text;
    if (budget === 0) return "";

    const suffix = "\n[...truncated]";
    const suffixTokens = estimateTokens(suffix);
    const contentBudget = Math.max(0, budget - suffixTokens);
    let low = 0;
    let high = text.length;
    while (low < high) {
        const midpoint = Math.ceil((low + high) / 2);
        const candidate = trimDanglingHighSurrogate(text.slice(0, midpoint));
        if (estimateTokens(candidate) <= contentBudget) low = midpoint;
        else high = midpoint - 1;
    }
    const prefix = trimDanglingHighSurrogate(text.slice(0, low));
    return prefix ? `${prefix}${suffix}` : suffix.trimStart();
}

function trimDanglingHighSurrogate(value: string): string {
    const last = value.charCodeAt(value.length - 1);
    return last >= 0xD800 && last <= 0xDBFF ? value.slice(0, -1) : value;
}

/**
 * Distribute a total token budget across N note contents, reserving space
 * for system prompt and structural overhead.
 */
function distributeNotesBudget(
    noteContents: ReadonlyArray<{ path: string; content: string }>,
    totalInputBudget: number,
    systemPromptOverhead: number,
): Array<{ path: string; content: string }> {
    if (noteContents.length === 0) return [];
    const available = Math.max(0, totalInputBudget - systemPromptOverhead);
    const perNote = Math.max(1, Math.floor(available / noteContents.length));
    return noteContents.map((n) => ({
        path: n.path,
        content: truncateToTokenBudget(n.content, perNote),
    }));
}

/** Format note contents into a prompt-friendly representation. */
function formatNotes(notes: ReadonlyArray<{ path: string; content: string }>): string {
    return notes
        .map((n) => `--- ${n.path} ---\n${n.content}`)
        .join("\n\n");
}

// ---------------------------------------------------------------------------
// Shared JSON output schema (embedded in prompts)
// ---------------------------------------------------------------------------

const STRUCTURED_OUTPUT_SCHEMA = [
    "Output JSON format (no code fences, no commentary outside JSON):",
    "{",
    '  "findings": [',
    "    {",
    '      "text": "<one-sentence insight or suggestion>",',
    '      "sourceFile": "<vault-relative path of the source note>",',
    '      "sourceTitle": "<display title of the source note>",',
    '      "category": "insight" | "action" | "connection" | "gap"',
    "    }",
    "  ],",
    '  "summary": "<optional one-sentence overall summary>"',
    "}",
].join("\n");

// ---------------------------------------------------------------------------
// System prompt base (shared across scenarios)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_BASE = [
    "You are Pagelet, a quiet note-analysis assistant for an Obsidian vault.",
    "You analyze the user's notes and produce structured findings.",
    "",
    "STRICT RULES:",
    "- Respond with a JSON object that strictly conforms to the provided schema; no prose outside JSON.",
    '- Every finding MUST include a "sourceFile" field set to the vault-relative path of the note it refers to.',
    '- Every finding MUST include a "sourceTitle" field set to the display title (filename without extension) of the source note.',
    '- "category" MUST be one of: insight, action, connection, gap.',
    "- Write in the same language as the notes. If notes are in Chinese, respond in Chinese. If in English, respond in English.",
    "- Return an empty findings array if there is nothing meaningful to say.",
    "- NEVER fabricate information not present in the provided notes.",
].join("\n");

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * **Background preparation** (fast/cheap): produce 2-3 one-sentence insights
 * from recently modified notes with minimal token usage.
 */
export function buildPreloadPrompt(
    noteContents: Array<{ path: string; content: string }>,
    budget: { input: number; output: number },
): PromptBuildResult {
    const systemPrompt = [
        SYSTEM_PROMPT_BASE,
        "",
        "SCENARIO: Background review preparation.",
        "- Produce exactly 2-3 one-sentence insights. Be concise.",
        "- Focus on the most interesting or actionable observations.",
        "- Do NOT produce more than 3 findings.",
        "",
        STRUCTURED_OUTPUT_SCHEMA,
    ].join("\n");

    const buildUserPrompt = (notes: ReadonlyArray<{ path: string; content: string }>): string => [
        `Analyze these ${noteContents.length} note(s) and produce 2-3 brief insights:`,
        "",
        formatNotes(notes),
        "",
        "Produce the JSON output now.",
    ].join("\n");
    const emptyNotes = noteContents.map(({ path }) => ({ path, content: "" }));
    const fixedInputTokens = estimateTokens(`${systemPrompt}\n\n${buildUserPrompt(emptyNotes)}`);
    // `estimateTokens` rounds each ASCII run up. Reserve a small per-note margin
    // so composing separately-truncated contents can never exceed the envelope.
    const compositionMargin = noteContents.length + 2;
    const contentBudget = Math.max(0, budget.input - fixedInputTokens - compositionMargin);
    const truncated = distributeNotesBudget(noteContents, contentBudget, 0);
    const userPrompt = buildUserPrompt(truncated);

    return { systemPrompt, userPrompt, maxOutputTokens: Math.min(budget.output, 512) };
}

/**
 * **Discovery**: find connections between the current note and a set of
 * related notes. Designed to surface links the user might not see.
 */
export function buildDiscoveryPrompt(
    currentNote: { path: string; content: string },
    relatedNotes: Array<{ path: string; content: string }>,
    budget: { input: number; output: number },
): PromptBuildResult {
    const systemOverhead = 400;
    // Give the current note 40% of the budget, related notes share the rest.
    const currentBudget = Math.floor((budget.input - systemOverhead) * 0.4);
    const relatedBudget = budget.input - systemOverhead - currentBudget;

    const truncatedCurrent = {
        path: currentNote.path,
        content: truncateToTokenBudget(currentNote.content, currentBudget),
    };
    const truncatedRelated = distributeNotesBudget(relatedNotes, relatedBudget, 0);

    const systemPrompt = [
        SYSTEM_PROMPT_BASE,
        "",
        "SCENARIO: Connection discovery between notes.",
        "- The user has a current note and a set of related notes from the vault.",
        "- Find thematic connections, contradictions, or complementary ideas between them.",
        "- Each finding should reference both the current note and at least one related note.",
        '- Prefer category "connection" for thematic links or surprising overlaps and "gap" for missing bridges or follow-up actions.',
        '- Categories "insight" and "action" are tolerated for compatibility, but use "connection" and "gap" when possible.',
        "- Produce up to 5 findings.",
        "",
        STRUCTURED_OUTPUT_SCHEMA,
    ].join("\n");

    const userPrompt = [
        "Find connections between the current note and related notes:",
        "",
        "== Current Note ==",
        `--- ${truncatedCurrent.path} ---`,
        truncatedCurrent.content,
        "",
        "== Related Notes ==",
        formatNotes(truncatedRelated),
        "",
        "Produce the JSON output now.",
    ].join("\n");

    return { systemPrompt, userPrompt, maxOutputTokens: Math.min(budget.output, 1024) };
}

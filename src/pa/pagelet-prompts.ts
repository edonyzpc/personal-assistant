import type { RecapLlmInsight } from "./scope-recap";
import type { ReviewQueueScope } from "./contracts";
import { detectNoteLanguage } from "../locales/pagelet/language-detect";
import type { PageletOutputLanguageSetting } from "../settings/pagelet/index";

// ---------------------------------------------------------------------------
// Language Resolution
// ---------------------------------------------------------------------------

export function resolveOutputLanguage(
    setting: PageletOutputLanguageSetting,
    noteContent: string,
): "zh" | "en" {
    return setting === "auto" ? detectNoteLanguage(noteContent) : setting;
}

function buildLanguageDirective(language: "zh" | "en"): string {
    return language === "zh"
        ? "IMPORTANT: respond in Simplified Chinese."
        : "IMPORTANT: respond in English.";
}

// ---------------------------------------------------------------------------
// Scope Recap Insights Prompt
// ---------------------------------------------------------------------------

export function buildRecapInsightsPrompt(input: {
    scope: ReviewQueueScope;
    noteDigests: Array<{ title: string; digest: string; tags: string[] }>;
    language?: "zh" | "en";
}): string {
    const notesBlock = input.noteDigests
        .map((n, i) => `Note ${i + 1}: "${n.title}"\nTags: ${n.tags.join(", ") || "none"}\n${n.digest}`)
        .join("\n\n");

    return `You are analyzing a set of user's personal notes to surface genuine insights.

## Input
${notesBlock}

## Task
Produce 2-4 insights about this set of notes. Each insight must:
1. Reference specific notes by their title (for source attribution)
2. Explain WHY this insight is worth the user's attention — not just WHAT it observes
3. Be something the user likely hasn't explicitly written down
4. Put the observation in summary and the concrete consequence or unresolved choice in whyItMatters

## Quality gate
- If the notes have no meaningful relationship beyond sharing a tag, return an empty array.
- "These notes all discuss X" is NOT an insight. "Note A and Note B take opposite stances on X, which may indicate an unresolved decision" IS an insight.
- Prefer tensions, contradictions, implicit questions, and unfinished threads over summaries.
- A specific single-note insight is allowed for explicit click-to-view; only cross-note insights can trigger a proactive hint.

## Output format (JSON array only, no markdown fences)
[{"title":"short headline under 15 words","summary":"specific cross-note observation","whyItMatters":"one concrete consequence, decision, or unresolved question","sourceNoteTitles":["Note A title","Note B title"],"section":"theme"|"tension"|"open_question"}]

Return [] if nothing genuinely insightful can be said.

${input.language ? buildLanguageDirective(input.language) : ""}`;
}

export function parseRecapInsightsResponse(text: string): RecapLlmInsight[] | null {
    try {
        const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) return null;
        const isInsight = (item: unknown): item is RecapLlmInsight => {
            if (!item || typeof item !== "object") return false;
            const obj = item as Record<string, unknown>;
            return typeof obj.title === "string" && obj.title.trim().length > 0
                && typeof obj.summary === "string" && obj.summary.trim().length > 0
                && typeof obj.whyItMatters === "string" && obj.whyItMatters.trim().length > 0
                && Array.isArray(obj.sourceNoteTitles)
                && obj.sourceNoteTitles.length >= 1
                && obj.sourceNoteTitles.every((title) => typeof title === "string" && title.trim().length > 0)
                && (obj.section === "theme" || obj.section === "tension" || obj.section === "open_question");
        };
        // Mixed-validity output is malformed as a whole. Silently dropping
        // invalid elements would let a partial provider schema pass the strict
        // Recap delivery gate.
        if (!parsed.every(isInsight)) return null;
        return parsed;
    } catch {
        return null;
    }
}

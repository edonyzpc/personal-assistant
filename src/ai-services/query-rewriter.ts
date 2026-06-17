export const REWRITE_TIMEOUT_MS = 30_000;

export const REWRITE_SYSTEM_PROMPT = [
    "Extract search keywords from the user's question for full-text search in a personal knowledge base.",
    'Return ONLY valid JSON: {"keywords":"<space-separated keywords>","temporal":"recent_7d|recent_30d|range:YYYY-MM-DD..YYYY-MM-DD|none"}',
    "Rules:",
    "- Extract 2-6 important terms from the query",
    "- Keep technical terms, proper nouns, error codes, function names verbatim",
    "- Remove filler words and conversational phrases",
    "- For Chinese text, keep key noun phrases (2-4 chars each)",
    "- If the query is already concise keywords, return it unchanged",
    "- Never invent terms not present in the original query",
    "- Set temporal to recent_7d or recent_30d when the user asks about recent/latest/current work",
    '- Use range:YYYY-MM-DD..YYYY-MM-DD when the user specifies a date range (e.g., "from January to March 2025" → "range:2025-01-01..2025-03-31")',
    "- Otherwise use none",
].join("\n");

export type RewriteInvoker = (query: string, signal?: AbortSignal) => Promise<string>;
export type QueryTemporalIntent = "recent_7d" | "recent_30d" | "none" | `range:${string}`;

export interface RewrittenQuery {
    keywords: string | null;
    temporal: QueryTemporalIntent;
}

export function isShortQuery(query: string): boolean {
    const trimmed = query.trim();
    const tokens = trimmed.split(/\s+/).length;
    if (tokens >= 4) return false;
    // Few space-separated tokens but many characters → likely CJK sentence, not short
    if (trimmed.length > 15) return false;
    return true;
}

export async function rewriteQuery(
    query: string,
    invoke: RewriteInvoker,
    signal?: AbortSignal,
): Promise<string | null> {
    return (await rewriteQueryForSearch(query, invoke, signal)).keywords;
}

export async function rewriteQueryForSearch(
    query: string,
    invoke: RewriteInvoker,
    signal?: AbortSignal,
): Promise<RewrittenQuery> {
    if (isShortQuery(query)) {
        return { keywords: null, temporal: detectTemporalIntentFromQuery(query) };
    }

    const content = await invoke(query, signal);
    return parseRewrittenQuery(content);
}

export function parseKeywordQuery(content: string): string | null {
    return parseRewrittenQuery(content).keywords;
}

export function parseRewrittenQuery(content: string): RewrittenQuery {
    const trimmed = content.trim();
    const jsonText = extractJsonObject(trimmed);
    if (jsonText) {
        try {
            const parsed = JSON.parse(jsonText);
            return {
                keywords: typeof parsed?.keywords === "string" && parsed.keywords.trim().length > 0
                    ? parsed.keywords.trim()
                    : null,
                temporal: normalizeTemporalIntent(parsed?.temporal),
            };
        } catch { /* fall through to forgiving regex parser */ }
    }

    const keywordMatch = trimmed.match(/"keywords"\s*:\s*"([^"]*)"/);
    if (keywordMatch) {
        const keywords = keywordMatch[1].trim();
        return {
            keywords: keywords.length > 0 ? keywords : null,
            temporal: parseTemporalIntent(trimmed),
        };
    }
    return { keywords: null, temporal: "none" };
}

function extractJsonObject(content: string): string | null {
    const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenced?.[1]?.trim() ?? content;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return candidate.slice(start, end + 1);
}

function parseTemporalIntent(content: string): QueryTemporalIntent {
    const match = content.match(/"temporal"\s*:\s*"([^"]+)"/);
    return normalizeTemporalIntent(match?.[1]);
}

function normalizeTemporalIntent(value: unknown): QueryTemporalIntent {
    if (value === "recent_7d" || value === "recent_30d") return value;
    if (typeof value === "string" && value.startsWith("range:")) {
        const rangePart = value.slice(6);
        const match = rangePart.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
        if (match && !isNaN(Date.parse(match[1])) && !isNaN(Date.parse(match[2]))) {
            return value as QueryTemporalIntent;
        }
    }
    return "none";
}

function detectTemporalIntentFromQuery(query: string): QueryTemporalIntent {
    const normalized = query.toLowerCase();
    if (/\b(today|this week|latest|recent|recently|current|now)\b/.test(normalized)
        || /(?:今天|本周|最近|近期|最新|当前|现在)/.test(query)) {
        return "recent_30d";
    }
    if (/\b(yesterday|last week)\b/.test(normalized) || /(?:昨天|上周)/.test(query)) {
        return "recent_7d";
    }
    return "none";
}

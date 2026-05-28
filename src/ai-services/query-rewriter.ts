export const REWRITE_TIMEOUT_MS = 30_000;

export const REWRITE_SYSTEM_PROMPT = [
    "Extract search keywords from the user's question for full-text search in a personal knowledge base.",
    'Return ONLY valid JSON: {"keywords":"<space-separated keywords>"}',
    "Rules:",
    "- Extract 2-6 important terms from the query",
    "- Keep technical terms, proper nouns, error codes, function names verbatim",
    "- Remove filler words and conversational phrases",
    "- For Chinese text, keep key noun phrases (2-4 chars each)",
    "- If the query is already concise keywords, return it unchanged",
    "- Never invent terms not present in the original query",
].join("\n");

export type RewriteInvoker = (query: string, signal?: AbortSignal) => Promise<string>;

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
    if (isShortQuery(query)) return null;

    const content = await invoke(query, signal);
    return parseKeywordQuery(content);
}

export function parseKeywordQuery(content: string): string | null {
    const trimmed = content.trim();
    const jsonMatch = trimmed.match(/\{[^}]*"keywords"\s*:\s*"([^"]+)"[^}]*\}/);
    if (jsonMatch?.[1]) {
        const keywords = jsonMatch[1].trim();
        return keywords.length > 0 ? keywords : null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed?.keywords === "string" && parsed.keywords.trim().length > 0) {
            return parsed.keywords.trim();
        }
    } catch { /* not valid JSON */ }
    return null;
}

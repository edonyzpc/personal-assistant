const FTS5_RESERVED = /^(NEAR|AND|OR|NOT)$/i;
const FTS5_SPECIAL = /["*^+\-():]/;
const CJK_CHAR = /[一-鿿㐀-䶿豈-﫿]/;

let _segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
    if (_segmenter !== undefined) return _segmenter;
    try {
        _segmenter = new Intl.Segmenter("zh", { granularity: "word" });
    } catch {
        _segmenter = null;
    }
    return _segmenter;
}

function escapeToken(token: string): string {
    if (FTS5_RESERVED.test(token) || FTS5_SPECIAL.test(token)) {
        return `"${token.replace(/"/g, '""')}"`;
    }
    return token;
}

function buildWithSegmenter(query: string, seg: Intl.Segmenter): string | null {
    const tokens: string[] = [];

    for (const { segment, isWordLike } of seg.segment(query)) {
        if (!isWordLike) continue;

        if (CJK_CHAR.test(segment)) {
            const chars = [...segment].filter(c => CJK_CHAR.test(c));
            if (chars.length === 0) continue;
            // Single CJK char → bare token; multi-char → phrase query for adjacency
            tokens.push(chars.length === 1 ? chars[0] : `"${chars.join(" ")}"`);
        } else {
            const escaped = escapeToken(segment);
            if (escaped.length > 0) tokens.push(escaped);
        }
    }

    return tokens.length > 0 ? tokens.join(" ") : null;
}

function buildFallback(query: string): string | null {
    const rawTokens = query.split(/[\s,;!?。，；！？·]+/).filter(Boolean);

    const tokens = rawTokens.map(token => escapeToken(token)).filter(t => t.length > 0);

    return tokens.length > 0 ? tokens.join(" ") : null;
}

/**
 * Build a FTS5 MATCH expression from a raw query string.
 * Uses Intl.Segmenter for CJK word segmentation when available,
 * converting CJK words to phrase queries for adjacency matching
 * against unicode61's per-character tokenization.
 * Falls back to whitespace splitting when Segmenter is unavailable.
 */
export function buildFtsQuery(query: string): string | null {
    if (!query || typeof query !== "string") return null;

    const seg = getSegmenter();
    return seg ? buildWithSegmenter(query, seg) : buildFallback(query);
}

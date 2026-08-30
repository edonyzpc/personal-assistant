import type { RetrievalQueryMode } from "./retrieval-calibration";

export const CHAR_PHRASE_PROFILE_ID = "char-phrase-v1" as const;
export const CHAR_PHRASE_TOKENIZER = "unicode61 remove_diacritics 2" as const;

const FTS5_RESERVED = /^(NEAR|AND|OR|NOT)$/i;
const FTS5_SAFE_BAREWORD = /^[\p{L}\p{M}\p{N}_]+$/u;
const PLAIN_WORD_SIGNAL = /[\p{L}\p{M}\p{N}_]/u;
const CJK_SCRIPT = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const QUERY_SPLIT = /[\s,;:!?。，、；：！？·・]+/u;
const QUERY_CLAUSE_SPLIT = /[,;，；]+/u;

let graphemeSegmenter: Intl.Segmenter | null | undefined;

export interface CharPhraseRun {
    isCjk: boolean;
    value: string;
}

export interface CharPhraseFields {
    title: string;
    heading: string;
    body: string;
    path: string;
}

function getGraphemeSegmenter(): Intl.Segmenter | null {
    if (graphemeSegmenter !== undefined) return graphemeSegmenter;
    try {
        graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
    } catch {
        graphemeSegmenter = null;
    }
    return graphemeSegmenter;
}

export function hasCharPhraseRuntimeSupport(): boolean {
    return getGraphemeSegmenter() !== null;
}

export function segmentGraphemes(value: string): string[] {
    const segmenter = getGraphemeSegmenter();
    if (!segmenter) {
        throw createLexicalNormalizationError(
            "lexical-segmenter-unavailable",
            "This runtime does not support Intl.Segmenter grapheme segmentation.",
        );
    }
    return [...segmenter.segment(value.normalize("NFC"))].map(({ segment }) => segment);
}

export function isCjkLexicalGrapheme(grapheme: string): boolean {
    return CJK_SCRIPT.test(grapheme) && LETTER_OR_MARK.test(grapheme);
}

export function splitCharPhraseRuns(value: string): CharPhraseRun[] {
    const runs: CharPhraseRun[] = [];
    for (const grapheme of segmentGraphemes(value)) {
        const isCjk = isCjkLexicalGrapheme(grapheme);
        const previous = runs[runs.length - 1];
        if (previous?.isCjk === isCjk) {
            previous.value += grapheme;
        } else {
            runs.push({ isCjk, value: grapheme });
        }
    }
    return runs;
}

export function encodeCharPhraseGrapheme(grapheme: string): string {
    const encoded = [...grapheme.normalize("NFC")]
        .map((character) => character.codePointAt(0)?.toString(16) ?? "")
        .filter(Boolean)
        .join("x");
    return `c${encoded}`;
}

export function charPhraseTokens(value: string): string[] {
    return segmentGraphemes(value)
        .filter(isCjkLexicalGrapheme)
        .map(encodeCharPhraseGrapheme);
}

export function transformCharPhraseDocument(value: string): string {
    return splitCharPhraseRuns(value)
        .map((run) => run.isCjk ? charPhraseTokens(run.value).join(" ") : run.value)
        .join(" ")
        .normalize("NFC")
        .replace(/\s+/gu, " ")
        .trim();
}

export function buildCharPhraseFtsQuery(
    value: string,
    mode: RetrievalQueryMode = "strict_AND",
): string | null {
    if (!value || typeof value !== "string") return null;
    if (mode === "clause_OR") {
        const clauses = value
            .split(QUERY_CLAUSE_SPLIT)
            .map((clause) => buildStrictCharPhraseFtsQuery(clause))
            .filter((clause): clause is string => Boolean(clause));
        if (clauses.length === 0) return null;
        return clauses.length === 1
            ? clauses[0]
            : clauses.map((clause) => `(${clause})`).join(" OR ");
    }
    return buildStrictCharPhraseFtsQuery(value);
}

function buildStrictCharPhraseFtsQuery(value: string): string | null {
    const pieces: string[] = [];
    for (const run of splitCharPhraseRuns(value)) {
        if (run.isCjk) {
            const tokens = charPhraseTokens(run.value);
            if (tokens.length === 1) {
                pieces.push(tokens[0]);
            } else if (tokens.length > 1) {
                pieces.push(`"${tokens.join(" ")}"`);
            }
            continue;
        }
        const plain = buildPlainFtsQuery(run.value);
        if (plain) pieces.push(plain);
    }
    return pieces.length > 0 ? pieces.join(" ") : null;
}

export function buildCharPhraseFields(input: {
    path: string;
    headingPath?: unknown;
    content: string;
}): CharPhraseFields {
    const normalizedPath = input.path.normalize("NFC").replace(/\\/g, "/");
    const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
    const title = basename.replace(/\.md$/iu, "");
    const headingPath = Array.isArray(input.headingPath)
        ? input.headingPath.filter((value): value is string => typeof value === "string")
        : [];
    return {
        title: transformCharPhraseDocument(title),
        heading: transformCharPhraseDocument(headingPath.join(" ")),
        body: transformCharPhraseDocument(input.content),
        path: transformCharPhraseDocument(normalizeBoundedPathSurface(normalizedPath)),
    };
}

export function normalizeBoundedPathSurface(path: string): string {
    const segments = path
        .normalize("NFC")
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .slice(-2);
    if (segments.length > 0) {
        segments[segments.length - 1] = segments[segments.length - 1].replace(/\.md$/iu, "");
    }
    return segments
        .join(" ")
        .replace(/[._-]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 160);
}

export function getCharPhraseRuntimeCanaryFingerprint(): string {
    const payload = [
        "召回。",
        "乒乓球拍",
        "東京大学生協",
        "日本語・検索",
        "々ー",
        "葛\u{E0100}",
    ].map((value) => ({
        value,
        graphemes: segmentGraphemes(value),
        transformed: transformCharPhraseDocument(value),
    }));
    const canonical = JSON.stringify({
        profileId: CHAR_PHRASE_PROFILE_ID,
        tokenizer: CHAR_PHRASE_TOKENIZER,
        payload,
    });
    return `${CHAR_PHRASE_PROFILE_ID}:${fnv1a32(canonical, 0x811c9dc5)}${fnv1a32(canonical, 0x9e3779b9)}`;
}

function buildPlainFtsQuery(value: string): string | null {
    const tokens = value
        .normalize("NFC")
        .split(QUERY_SPLIT)
        .map((token) => token.trim())
        .filter((token) => token.length > 0 && PLAIN_WORD_SIGNAL.test(token))
        .map(escapeFtsToken);
    return tokens.length > 0 ? tokens.join(" ") : null;
}

function escapeFtsToken(token: string): string {
    if (!FTS5_RESERVED.test(token) && FTS5_SAFE_BAREWORD.test(token)) return token;
    return `"${token.replace(/"/g, '""')}"`;
}

function fnv1a32(value: string, seed: number): string {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

function createLexicalNormalizationError(code: string, message: string): Error {
    const error = new Error(message);
    (error as Error & { code: string }).code = code;
    return error;
}

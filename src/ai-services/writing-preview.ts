/** A display snapshot only. Neither variant proves completion or permits saving a version. */
export type WritingPreview = { kind: "body" | "prose"; text: string };

type JsonStringPrefix = {
    state: "complete" | "partial" | "invalid";
    value: string;
    next: number;
};

const ENVELOPE_KEYS = new Set(["kind", "version", "requestId", "body", "explanation"]);
const JSON_WHITESPACE = /[\t\n\r ]/;

/**
 * Decode a cumulative display snapshot without repairing JSON or validating an artifact.
 * Later malformed input may invalidate an earlier preview; callers must use snapshots,
 * not append raw protocol text. Source/permission checks remain the caller's responsibility.
 */
export function decodeWritingPreview(
    rawText: string,
    requestId: string,
    maxTextChars: number,
): WritingPreview | undefined {
    if (!Number.isSafeInteger(maxTextChars) || maxTextChars <= 0 || rawText.length > maxTextChars
        || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return undefined;

    let cursor = skipWhitespace(rawText, 0);
    let fenced = false;
    if (rawText[cursor] === "`") {
        const opening = /^```json[\t ]*\r?\n/i.exec(rawText.slice(cursor));
        if (!opening) return undefined;
        fenced = true;
        cursor = skipWhitespace(rawText, cursor + opening[0].length);
    }
    if (rawText[cursor] !== "{") {
        return fenced ? undefined : plainProsePreview(rawText);
    }

    cursor++;
    const seen = new Set<string>();
    let kindVerified = false;
    let versionVerified = false;
    let requestVerified = false;
    let body: string | undefined;
    const preview = (): WritingPreview | undefined => (
        kindVerified && versionVerified && requestVerified && body !== undefined
            ? { kind: "body", text: body }
            : undefined
    );

    while (cursor <= rawText.length) {
        cursor = skipWhitespace(rawText, cursor);
        if (cursor === rawText.length) return preview();
        const key = readJsonStringPrefix(rawText, cursor);
        if (key.state === "invalid") return undefined;
        if (key.state === "partial") return preview();
        if (!ENVELOPE_KEYS.has(key.value) || seen.has(key.value)) return undefined;
        seen.add(key.value);
        cursor = skipWhitespace(rawText, key.next);
        if (cursor === rawText.length) return preview();
        if (rawText[cursor] !== ":") return undefined;
        cursor = skipWhitespace(rawText, cursor + 1);
        if (cursor === rawText.length) return preview();

        if (key.value === "version") {
            const start = cursor;
            while (cursor < rawText.length && !JSON_WHITESPACE.test(rawText[cursor])
                && rawText[cursor] !== "," && rawText[cursor] !== "}") cursor++;
            // A delimiter is required: a trailing `1` might still become `12`.
            if (cursor === rawText.length) return undefined;
            const number = rawText.slice(start, cursor);
            if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(number)
                || Number(number) !== 1) return undefined;
            versionVerified = true;
        } else {
            const value = readJsonStringPrefix(rawText, cursor);
            if (value.state === "invalid") return undefined;
            if (key.value === "body") body = value.value;
            if (value.state === "partial") return preview();
            cursor = value.next;
            if (key.value === "kind") {
                if (value.value !== "pa.writing") return undefined;
                kindVerified = true;
            } else if (key.value === "requestId") {
                if (value.value !== requestId) return undefined;
                requestVerified = true;
            }
        }

        cursor = skipWhitespace(rawText, cursor);
        if (cursor === rawText.length) return preview();
        if (rawText[cursor] === "}") {
            if (seen.size !== ENVELOPE_KEYS.size || !validEnvelopeTail(rawText.slice(cursor + 1), fenced)) {
                return undefined;
            }
            return preview();
        }
        if (rawText[cursor] !== ",") return undefined;
        cursor++;
    }
    return undefined;
}

/**
 * Preview only the arguments of a host-identified present_writing call. The
 * caller owns source/lifetime admission; this does not validate a context handle
 * or authorize an artifact. Final structure and provider completion remain gates.
 */
export function decodeNativeWritingPreview(rawText: string, maxTextChars: number): WritingPreview | undefined {
    if (!Number.isSafeInteger(maxTextChars) || maxTextChars <= 0 || rawText.length > maxTextChars) return undefined;
    let cursor = skipWhitespace(rawText, 0);
    if (rawText[cursor++] !== "{") return undefined;
    let body: string | undefined;
    const seen = new Set<string>();
    const preview = (): WritingPreview | undefined => body === undefined ? undefined : { kind: "body", text: body };
    while (cursor < rawText.length) {
        cursor = skipWhitespace(rawText, cursor);
        if (cursor === rawText.length) return preview();
        const key = readJsonStringPrefix(rawText, cursor);
        if (key.state === "invalid") return undefined;
        if (key.state === "partial") return preview();
        if (!["body", "contextHandle", "explanation"].includes(key.value) || seen.has(key.value)) return undefined;
        seen.add(key.value);
        cursor = skipWhitespace(rawText, key.next);
        if (cursor === rawText.length) return preview();
        if (rawText[cursor++] !== ":") return undefined;
        cursor = skipWhitespace(rawText, cursor);
        if (cursor === rawText.length) return preview();
        const value = readJsonStringPrefix(rawText, cursor);
        if (value.state === "invalid") return undefined;
        if (key.value === "body") body = value.value;
        if (value.state === "partial") return preview();
        cursor = skipWhitespace(rawText, value.next);
        if (cursor === rawText.length) return preview();
        if (rawText[cursor] === "}") {
            return skipWhitespace(rawText, cursor + 1) === rawText.length ? preview() : undefined;
        }
        if (rawText[cursor++] !== ",") return undefined;
    }
    return preview();
}

function skipWhitespace(text: string, start: number): number {
    let cursor = start;
    while (cursor < text.length && JSON_WHITESPACE.test(text[cursor])) cursor++;
    return cursor;
}

function readJsonStringPrefix(text: string, start: number): JsonStringPrefix {
    let cursor = start;
    let value = "";
    let highSurrogate = "";
    const result = (state: JsonStringPrefix["state"]): JsonStringPrefix => ({ state, value, next: cursor });
    if (text[cursor] !== '"') return result("invalid");
    cursor++;
    while (cursor < text.length) {
        let character = text[cursor++];
        if (character === '"') return result(highSurrogate ? "invalid" : "complete");
        if (character === "\\") {
            if (cursor === text.length) return result("partial");
            const escape = text[cursor++];
            if (escape === "u") {
                const digits = text.slice(cursor, cursor + 4);
                if (!/^[0-9a-f]*$/i.test(digits)) return result("invalid");
                if (digits.length < 4) return result("partial");
                character = String.fromCharCode(Number.parseInt(digits, 16));
                cursor += 4;
            } else {
                const escaped = decodeSimpleEscape(escape);
                if (escaped === undefined) return result("invalid");
                character = escaped;
            }
        } else if (character.charCodeAt(0) < 0x20) {
            return result("invalid");
        }

        const code = character.charCodeAt(0);
        if (highSurrogate) {
            if (code < 0xdc00 || code > 0xdfff) return result("invalid");
            value += highSurrogate + character;
            highSurrogate = "";
        } else if (code >= 0xd800 && code <= 0xdbff) {
            highSurrogate = character;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return result("invalid");
        } else {
            value += character;
        }
    }
    return result("partial");
}

function decodeSimpleEscape(escape: string): string | undefined {
    switch (escape) {
        case '"': return '"';
        case "\\": return "\\";
        case "/": return "/";
        case "b": return "\b";
        case "f": return "\f";
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        default: return undefined;
    }
}

function validEnvelopeTail(tail: string, fenced: boolean): boolean {
    const marker = skipWhitespace(tail, 0);
    if (marker === tail.length) return true;
    if (!fenced || marker === 0 || tail[marker - 1] !== "\n") return false;
    const closing = tail.slice(marker);
    if (/^`{1,3}$/.test(closing)) return true;
    return closing.startsWith("```") && skipWhitespace(closing, 3) === closing.length;
}

function plainProsePreview(rawText: string): WritingPreview | undefined {
    const first = rawText.slice(skipWhitespace(rawText, 0));
    if (!first || "[]{}\"`~<>".includes(first[0]) || /^[\d+.\uFEFF-]/.test(first)
        || ["true", "false", "null"].some((literal) => literal.startsWith(first))
        || /^(?:true|false|null)(?:\s|$)/.test(first)
        || ["{", "}", "[", "]", "```", "~~~"].some((marker) => rawText.includes(marker))) return undefined;
    // A raw UTF-16 pair may itself be split between cumulative snapshots.
    let end = rawText.length;
    const last = rawText.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    const text = rawText.slice(0, end);
    for (let cursor = 0; cursor < text.length; cursor++) {
        const code = text.charCodeAt(cursor);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(++cursor);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
        } else if (code >= 0xdc00 && code <= 0xdfff) return undefined;
    }
    return text ? { kind: "prose", text } : undefined;
}

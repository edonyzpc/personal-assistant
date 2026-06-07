/**
 * Shared helpers for per-tool prepareArguments hooks (pi-style).
 *
 * Each ChatToolDefinition's prepareArguments may use these to map alias keys
 * to canonical schema keys before validateInput runs. These helpers should NOT
 * throw — they return undefined on no match, letting validateInput throw with
 * a model-actionable error.
 *
 * Per the Tool Calling Refactor Plan (Phase A), these replace the cross-cutting
 * helpers previously in pa-agent-host-tools.ts:263-295.
 */

/**
 * Walk a list of candidate keys, returning the first trimmed non-empty string.
 * Recurses one level into a nested `value.input` field when no top-level match
 * is found (some models wrap args in `input: {...}`).
 */
export function readFirstString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === "string") {
            const trimmed = candidate.trim();
            if (trimmed) return trimmed;
        }
    }
    const nestedInput = value.input;
    if (nestedInput && typeof nestedInput === "object" && !Array.isArray(nestedInput)) {
        return readFirstString(nestedInput as Record<string, unknown>, keys.filter((key) => key !== "input"));
    }
    return undefined;
}

/**
 * Walk a list of candidate keys, returning the first positive integer.
 * Accepts numeric strings; recurses one level into `value.input` like readFirstString.
 */
export function readFirstPositiveNumber(value: Record<string, unknown>, keys: readonly string[]): number | undefined {
    for (const key of keys) {
        const candidate = value[key];
        const numericValue = typeof candidate === "number"
            ? candidate
            : typeof candidate === "string"
                ? Number(candidate.trim())
                : Number.NaN;
        if (Number.isFinite(numericValue) && numericValue > 0) {
            return Math.floor(numericValue);
        }
    }
    const nestedInput = value.input;
    if (nestedInput && typeof nestedInput === "object" && !Array.isArray(nestedInput)) {
        return readFirstPositiveNumber(nestedInput as Record<string, unknown>, keys.filter((key) => key !== "input"));
    }
    return undefined;
}

/**
 * Normalize any input value to a plain Record<string, unknown> for alias-key lookup,
 * or null if input is not an object (e.g., string / array / primitive).
 */
export function toInputRecord(input: unknown): Record<string, unknown> | null {
    if (input && typeof input === "object" && !Array.isArray(input)) {
        return input as Record<string, unknown>;
    }
    return null;
}

/**
 * Structural deep equality for plain JSON-like values (used by prepareAndValidate's
 * auto-detection of whether a tool's prepareArguments actually mutated input).
 *
 * Treats arrays as ordered tuples; objects by own-enumerable keys; primitives by ===.
 * Functions / Dates / Maps / Sets are NOT supported (tool inputs are JSON-serializable).
 */
export function deepEqualJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray) return false;
    if (aIsArray && bIsArray) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqualJson(a[i], b[i])) return false;
        }
        return true;
    }
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
        if (!deepEqualJson(aRecord[key], bRecord[key])) return false;
    }
    return true;
}

/**
 * Summarize raw tool input for Phase 4 preflight metadata. Caps length so we don't
 * persist large payloads as audit metadata.
 */
export function summarizeRawInput(raw: unknown, maxChars = 200): string {
    let serialized: string;
    try {
        serialized = JSON.stringify(raw);
    } catch {
        serialized = String(raw);
    }
    if (serialized.length <= maxChars) return serialized;
    return `${serialized.slice(0, maxChars - 3)}...`;
}

/**
 * Heuristic: did the user explicitly limit the request to current-note-only?
 * Used by `get_current_note_context.prepareArguments` to override mode to "full"
 * when paired with exact-token / find / search phrasing.
 *
 * Originally lived in pa-agent-required-capability-policy.ts; moved here so chat-tools.ts
 * prepareArguments can call it without circular import. The policy module still
 * re-exports it for backward compatibility.
 */
export function isExplicitCurrentNoteOnlyRequest(text: string): boolean {
    const normalized = text.toLowerCase();
    return /\b(current note|this note)\s+only\b/.test(normalized)
        || /\buse\s+(the\s+)?current note\s+only\b/.test(normalized)
        || /只(看|用|从)?(当前|这篇|本篇)笔记/.test(text)
        || /仅(看|用|从)?(当前|这篇|本篇)笔记/.test(text);
}

export function isExplicitNoWebRequest(text: string): boolean {
    const normalized = text.toLowerCase();
    return /\b(do not|don't|without|no)\s+(use\s+)?(web\s*search|searching the web|web search results|internet|online search)\b/.test(normalized)
        || /\b(do not|don't)\s+(go\s+)?online\b/.test(normalized)
        || [
            "不要联网",
            "不联网",
            "无需联网",
            "别联网",
            "不要上网",
            "不上网",
            "别上网",
            "不要网络搜索",
            "不要网页搜索",
            "不要搜索网页",
            "不要查网",
            "不查网",
            "不查网络",
            "不查网页",
        ].some((token) => text.includes(token));
}

/**
 * Heuristic: did the user explicitly request full current-note content (e.g., exact-token search)?
 * Combines isExplicitCurrentNoteOnlyRequest with English/中文 keyword cues.
 */
export function shouldUseFullCurrentNoteContext(userInput: string): boolean {
    if (!isExplicitCurrentNoteOnlyRequest(userInput)) return false;
    return /\b(token|prefix|exact|identifier|id|find|search|contains?|match|full token|whole token)\b/i.test(userInput)
        || /查找|寻找|搜索|精确|完整\s*token|全文|前缀/.test(userInput);
}

/**
 * Extract a path candidate from input, optionally filtering by allowed file extensions.
 * Returns the first matching path string found across common alias keys, or undefined.
 */
export function extractInputPath(input: unknown, allowedExtensions?: readonly string[]): string | undefined {
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (!trimmed) return undefined;
        if (allowedExtensions && !allowedExtensions.some((ext) => trimmed.toLowerCase().endsWith(ext))) {
            return undefined;
        }
        return trimmed;
    }
    const record = toInputRecord(input);
    if (!record) return undefined;
    const candidate = readFirstString(record, [
        "path",
        "notePath",
        "note_path",
        "filePath",
        "file_path",
        "file",
        "canvasPath",
        "canvas_path",
        "canvas",
        "note",
        "target",
        "input",
    ]);
    if (!candidate) return undefined;
    if (allowedExtensions && !allowedExtensions.some((ext) => candidate.toLowerCase().endsWith(ext))) {
        return undefined;
    }
    return candidate;
}

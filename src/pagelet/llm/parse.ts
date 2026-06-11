/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — LLM response parser.
 *
 * Parses raw LLM text into {@link StructuredLLMResponse}. Strategy:
 *   1. Extract JSON payload from the response (reuses v1 patterns)
 *   2. Validate against the expected shape
 *   3. Fall back to line-by-line text parsing if JSON extraction fails
 *   4. Never throws — always returns a best-effort result
 *
 * Reuses extraction helpers from `pa-review-schemas.ts`:
 *  - `extractJsonPayload()` — finds JSON in fenced or bare text
 *  - `tolerantJsonParse()` — handles trailing commas, etc.
 */

import { extractJsonPayload, tolerantJsonParse } from "../pa-review-schemas";
import type { StructuredFinding, StructuredLLMResponse } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an LLM text response into a structured response. Never throws;
 * returns an empty findings array on complete failure.
 */
export function parseStructuredResponse(text: string): StructuredLLMResponse {
    if (!text || text.trim().length === 0) {
        return { findings: [] };
    }

    // Strategy 1: try JSON extraction
    const jsonResult = tryParseJson(text);
    if (jsonResult) return jsonResult;

    // Strategy 2: fall back to line-by-line text parsing
    return parseLineByLine(text);
}

// ---------------------------------------------------------------------------
// JSON extraction path
// ---------------------------------------------------------------------------

function tryParseJson(text: string): StructuredLLMResponse | null {
    const payload = extractJsonPayload(text);
    if (!payload) return null;

    const parsed = tolerantJsonParse(payload);
    if (parsed == null) return null;

    return normalizeJsonPayload(parsed);
}

/**
 * Normalize a parsed JSON value into our expected shape. Handles both
 * the expected `{ findings: [...], summary?: "..." }` envelope and
 * bare arrays `[{ text, sourceFile, ... }]`.
 */
function normalizeJsonPayload(parsed: unknown): StructuredLLMResponse | null {
    if (!parsed || typeof parsed !== "object") return null;

    // Case 1: bare array of findings
    if (Array.isArray(parsed)) {
        const findings = parsed
            .map(normalizeFinding)
            .filter((f): f is StructuredFinding => f !== null);
        return findings.length > 0 ? { findings } : null;
    }

    const obj = parsed as Record<string, unknown>;

    // Case 2: envelope with "findings" array
    if (Array.isArray(obj.findings)) {
        const findings = obj.findings
            .map(normalizeFinding)
            .filter((f): f is StructuredFinding => f !== null);
        const summary = typeof obj.summary === "string" && obj.summary.trim().length > 0
            ? obj.summary.trim()
            : undefined;
        return { findings, summary };
    }

    // Case 3: single finding object (wrap in array)
    const single = normalizeFinding(obj);
    if (single) return { findings: [single] };

    return null;
}

/**
 * Normalize a single finding from a parsed JSON value. Returns null if
 * the value doesn't look like a finding (must have at least a "text" field).
 */
function normalizeFinding(raw: unknown): StructuredFinding | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;

    const text = coerceString(obj.text);
    if (!text) return null;

    const sourceFile = coerceString(obj.sourceFile) ?? coerceString(obj.source_file) ?? "";
    const sourceTitle = coerceString(obj.sourceTitle) ?? coerceString(obj.source_title) ?? "";
    const category = normalizeCategory(obj.category);

    return { text, sourceFile, sourceTitle, ...(category ? { category } : {}) };
}

function coerceString(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    return null;
}

const VALID_CATEGORIES = new Set(["insight", "action", "connection", "gap"]);

function normalizeCategory(
    value: unknown,
): "insight" | "action" | "connection" | "gap" | undefined {
    if (typeof value !== "string") return undefined;
    const lower = value.toLowerCase().trim();
    if (VALID_CATEGORIES.has(lower)) {
        return lower as "insight" | "action" | "connection" | "gap";
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Line-by-line fallback
// ---------------------------------------------------------------------------

/**
 * When JSON extraction fails entirely, attempt to extract findings from
 * plain-text lines. Heuristic: non-empty lines that look like bullet
 * points or numbered items become findings.
 */
function parseLineByLine(text: string): StructuredLLMResponse {
    const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const findings: StructuredFinding[] = [];

    for (const line of lines) {
        // Skip very short lines (likely headers or separators)
        if (line.length < 10) continue;

        // Strip common bullet/number prefixes
        const cleaned = line
            .replace(/^[-•*]\s*/, "")
            .replace(/^\d+[.)]\s*/, "")
            .trim();

        if (cleaned.length < 10) continue;

        findings.push({
            text: cleaned,
            sourceFile: "",
            sourceTitle: "",
        });

        // Cap at 6 findings from line-by-line parsing
        if (findings.length >= 6) break;
    }

    return { findings };
}

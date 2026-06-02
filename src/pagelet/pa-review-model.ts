/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — structured output orchestration.
 *
 * Spec source: `docs/review-assistant-sdd.md` §2.2 + §4 + D026.
 *
 * Responsibilities:
 *  - Take a `PageletReviewInput`, run the LLM, return a `PageletReviewOutcome`.
 *  - Happy path: `withStructuredOutput(zodSchema)` (D026.b — LangChain native).
 *  - Failure matrix (SDD §4.3, 8 rows): every row is handled here, NOT in
 *    UI/caller code. Each row is independently toggleable via
 *    `PageletReviewModelOptions` so the OQ002 spike can dial behavior per
 *    provider without rewriting orchestration.
 *
 * What this file does NOT do:
 *  - Create the underlying LangChain model — that's `AIUtils.createChatModel()`
 *    in `src/ai-services/`. We accept a factory so the Track A worktree
 *    (which owns ai-services) can swap providers without touching pagelet.
 *  - Render suggestions — B2 owns SuggestionCard.
 *  - File IO — B6 owns `.pagelet/` persistence.
 *  - Cost / rate limiting — B4 owns gating; the caller runs that BEFORE
 *    invoking `reviewNote`.
 *
 * Failure matrix coverage (SDD §4.3):
 *  | # | Failure mode               | Handler                                                         |
 *  |---|----------------------------|-----------------------------------------------------------------|
 *  | 1 | schema mismatch            | one corrective retry, then surface schema_invalid               |
 *  | 2 | missing source_id          | drop bad suggestions; if all drop, retry then surface           |
 *  | 3 | wrong field type           | included in #1 (zod surfaces typed issues)                      |
 *  | 4 | empty suggestions[]        | success with status="empty"                                     |
 *  | 5 | over length                | truncate via `truncateOverlongFields` + mark truncated          |
 *  | 6 | partial parse              | keep valid suggestions, drop rest, mark partial                 |
 *  | 7 | timeout                    | abort propagation + "timeout" errorCode                         |
 *  | 8 | parse error                | free-form fallback: extract JSON, lenient parse, validate       |
 *  +---+----------------------------+------------------------------------------------------------------+
 *
 * Bonus: when the model has no `withStructuredOutput` (e.g. older Bailian
 * deployment), we degrade to a prompt-engineering JSON-mode call without
 * losing schema validation — see `runWithJsonMode`.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
    PageletReviewInputSchema,
    PageletReviewResultSchema,
    PageletSuggestionSchema,
    PAGELET_SCHEMA_VERSION,
    buildJsonModeSchemaHint,
    buildSystemPrompt,
    buildUserPrompt,
    extractJsonPayload,
    filterSuggestionsBySourceIds,
    summarizeZodIssues,
    tolerantJsonParse,
    truncateOverlongFields,
    type PageletReviewInput,
    type PageletReviewResult,
    type PageletSuggestion,
} from "./pa-review-schemas";

// ---------------------------------------------------------------------------
// Minimal LangChain model surface.
//
// We deliberately re-declare the shape rather than importing
// `BaseChatModel` / `ChatOpenAI` because:
//   1. Importing ai-services would violate this worktree's file domain.
//   2. The actual LangChain types are heavy / break Jest mocks easily.
//   3. We only need .invoke + optional .withStructuredOutput.
// The factory parameter shape mirrors `AIUtils.createChatModel`, so the
// adapter in `pa-review-runtime.ts` (future B-task) can pass it through 1:1.
// ---------------------------------------------------------------------------

export interface PageletChatModelLike {
    invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<{ content: unknown }>;
    /** Present on real ChatOpenAI; may be absent on hand-rolled providers. */
    withStructuredOutput?<TOut>(
        schema: unknown,
        options?: { name?: string; method?: string; strict?: boolean },
    ): {
        invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<TOut>;
    };
}

/** Roughly equivalent to `AIUtils["createChatModel"]`. */
export type PageletChatModelFactory = (
    temperature: number,
    options?: { modelName?: string; transport?: string },
) => Promise<PageletChatModelLike>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PageletReviewErrorCode =
    | "schema_invalid"
    | "parse_failed"
    | "timeout"
    | "provider_error";

export type PageletReviewPath =
    | "structured"
    | "structured_retry"
    | "free_form"
    | "json_mode"
    | "json_mode_retry";

export interface PageletReviewDiagnostics {
    path: PageletReviewPath;
    attempts: number;
    truncated: boolean;
    partial: boolean;
    droppedSuggestionsCount: number;
    schemaErrors: string[];
    providerError?: string;
    /** ms spent in LLM invocations (sum across attempts). */
    elapsedMs: number;
}

export type PageletReviewOutcome =
    | {
          status: "ok";
          result: PageletReviewResult;
          diagnostics: PageletReviewDiagnostics;
      }
    | {
          status: "empty";
          result: PageletReviewResult;
          diagnostics: PageletReviewDiagnostics;
      }
    | {
          status: "error";
          errorCode: PageletReviewErrorCode;
          userMessage: string;
          diagnostics: PageletReviewDiagnostics;
      };

export interface PageletReviewModelOptions {
    /** Max corrective retries after schema-invalid (failure-matrix row 1-3). Default 1. */
    maxRetries?: number;
    /**
     * Force-disable `withStructuredOutput` even when the model exposes it.
     * Set to `true` per provider once OQ002 spike confirms it's unreliable
     * (e.g. older Qwen variants where schema enforcement is best-effort).
     */
    disableStructuredOutput?: boolean;
    /**
     * Force-disable the free-form / JSON-mode fallback parser. Useful in
     * tests that want to assert schema_invalid surfacing.
     */
    disableFreeFormFallback?: boolean;
    /** Temperature for chat model creation. Default 0.2 (SDD §2.2). */
    temperature?: number;
    /** Override the chat model name (otherwise pulled from settings). */
    modelName?: string;
    /** Injectable clock for tests. */
    now?: () => number;
}

const DEFAULT_OPTIONS: Required<
    Pick<PageletReviewModelOptions, "maxRetries" | "temperature" | "disableStructuredOutput" | "disableFreeFormFallback">
> = {
    maxRetries: 1,
    temperature: 0.2,
    disableStructuredOutput: false,
    disableFreeFormFallback: false,
};

// ---------------------------------------------------------------------------
// Friendly error copy. Keeping these inline (not in i18n yet) because B3
// owns i18n key registration — leaving inert English strings makes the B3
// migration a single grep + replace later.
// ---------------------------------------------------------------------------

const USER_MESSAGES: Record<PageletReviewErrorCode, string> = {
    schema_invalid:
        "Pagelet review failed: the model's response did not match the expected structure. Please try again or send feedback.",
    parse_failed:
        "Pagelet review failed: the model's response could not be parsed. Please try again or send feedback.",
    timeout:
        "Pagelet review timed out. Try again, or shorten the note before retrying.",
    provider_error:
        "Pagelet review failed: the AI provider returned an error. Check your API key, provider, and model in settings.",
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Stateless orchestrator. Caller is expected to instantiate once and reuse
 * for many `reviewNote` calls — no per-call mutable state is kept.
 */
export class PageletReviewModel {
    private readonly factory: PageletChatModelFactory;
    private readonly options: PageletReviewModelOptions;

    constructor(
        factory: PageletChatModelFactory,
        options: PageletReviewModelOptions = {},
    ) {
        this.factory = factory;
        this.options = options;
    }

    async reviewNote(
        rawInput: PageletReviewInput,
        signal?: AbortSignal,
    ): Promise<PageletReviewOutcome> {
        // Validate input shape up front — bad inputs are programmer errors,
        // not LLM errors, and should fail loud rather than surface as
        // "provider_error" later.
        const parsedInput = PageletReviewInputSchema.parse(rawInput);
        const effectiveOpts = { ...DEFAULT_OPTIONS, ...this.options };
        const now = this.options.now ?? Date.now;

        const diagnostics: PageletReviewDiagnostics = {
            path: "structured",
            attempts: 0,
            truncated: false,
            partial: false,
            droppedSuggestionsCount: 0,
            schemaErrors: [],
            elapsedMs: 0,
        };

        const validSegmentIds = parsedInput.segments.map((s) => s.id);
        const systemPrompt = buildSystemPrompt(parsedInput.detectedLanguage);
        const userPrompt = buildUserPrompt(parsedInput);

        let model: PageletChatModelLike;
        try {
            model = await this.factory(effectiveOpts.temperature, {
                modelName: effectiveOpts.modelName,
            });
        } catch (err) {
            diagnostics.providerError = errorMessage(err);
            return errorOutcome("provider_error", diagnostics);
        }

        const canUseStructured =
            !effectiveOpts.disableStructuredOutput
            && typeof model.withStructuredOutput === "function";

        // Path A: structured output. Provider supports schema enforcement.
        if (canUseStructured) {
            const structuredOutcome = await this.runStructured(
                model,
                systemPrompt,
                userPrompt,
                validSegmentIds,
                parsedInput,
                effectiveOpts,
                diagnostics,
                now,
                signal,
            );
            if (structuredOutcome) return structuredOutcome;
            // structuredOutcome returns null when we should fall through to JSON mode.
        }

        // Path B: JSON mode (prompt-engineered) — fires either when the
        // provider has no withStructuredOutput, or when the structured path
        // exhausted retries AND free-form fallback is allowed.
        if (effectiveOpts.disableFreeFormFallback) {
            return errorOutcome(
                diagnostics.schemaErrors.length > 0 ? "schema_invalid" : "parse_failed",
                diagnostics,
            );
        }

        return this.runWithJsonMode(
            model,
            systemPrompt,
            userPrompt,
            validSegmentIds,
            parsedInput,
            effectiveOpts,
            diagnostics,
            now,
            signal,
        );
    }

    // ----- Structured path ---------------------------------------------------

    /**
     * Returns:
     *   - PageletReviewOutcome → terminal (success/empty or surfaced error)
     *   - null → caller should fall through to JSON-mode fallback
     */
    private async runStructured(
        model: PageletChatModelLike,
        systemPrompt: string,
        userPrompt: string,
        validSegmentIds: string[],
        input: PageletReviewInput,
        opts: typeof DEFAULT_OPTIONS,
        diagnostics: PageletReviewDiagnostics,
        now: () => number,
        signal?: AbortSignal,
    ): Promise<PageletReviewOutcome | null> {
        // Cast through unknown so we don't lock into a specific zod->Runnable
        // overload signature that may shift between LangChain releases.
        const structured = model.withStructuredOutput!<unknown>(
            PageletReviewResultSchema as unknown,
            { name: "pagelet_review", method: "json_schema", strict: true },
        );

        let attempt = 0;
        let lastZodErrors: string[] = [];
        let currentUserPrompt = userPrompt;

        // 1 attempt + N retries
        while (attempt <= opts.maxRetries) {
            diagnostics.path = attempt === 0 ? "structured" : "structured_retry";
            diagnostics.attempts += 1;
            const started = now();
            let raw: unknown;
            try {
                raw = await structured.invoke(
                    buildMessages(systemPrompt, currentUserPrompt),
                    signal ? { signal } : undefined,
                );
            } catch (err) {
                diagnostics.elapsedMs += Math.max(0, now() - started);
                if (isAbortError(err)) return errorOutcome("timeout", diagnostics);
                // withStructuredOutput throws on schema validation failure;
                // treat the throw as a schema-invalid signal and either
                // retry or fall through to free-form fallback.
                lastZodErrors = summarizeZodIssues(err);
                diagnostics.schemaErrors = lastZodErrors;
                diagnostics.providerError = errorMessage(err);
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendRetryHint(userPrompt, lastZodErrors);
                attempt += 1;
                continue;
            }
            diagnostics.elapsedMs += Math.max(0, now() - started);

            const finalized = finalizeStructuredPayload(raw, validSegmentIds, diagnostics);
            if (finalized.ok) return finalized.outcome;

            lastZodErrors = finalized.errors;
            diagnostics.schemaErrors = lastZodErrors;
            if (attempt === opts.maxRetries) break;
            currentUserPrompt = appendRetryHint(userPrompt, lastZodErrors);
            attempt += 1;
        }

        // Structured path exhausted. Caller decides whether to try JSON mode
        // (controlled by disableFreeFormFallback).
        return null;
    }

    // ----- JSON-mode (free-form fallback) path -------------------------------

    private async runWithJsonMode(
        model: PageletChatModelLike,
        systemPrompt: string,
        userPrompt: string,
        validSegmentIds: string[],
        input: PageletReviewInput,
        opts: typeof DEFAULT_OPTIONS,
        diagnostics: PageletReviewDiagnostics,
        now: () => number,
        signal?: AbortSignal,
    ): Promise<PageletReviewOutcome> {
        const augmentedSystem = `${systemPrompt}${buildJsonModeSchemaHint()}`;
        let attempt = 0;
        let currentUserPrompt = userPrompt;
        let lastErrorCode: PageletReviewErrorCode = "parse_failed";
        let lastZodErrors: string[] = [];

        while (attempt <= opts.maxRetries) {
            diagnostics.path = attempt === 0 ? "json_mode" : "json_mode_retry";
            diagnostics.attempts += 1;
            const started = now();
            let response: { content: unknown };
            try {
                response = await model.invoke(
                    buildMessages(augmentedSystem, currentUserPrompt),
                    signal ? { signal } : undefined,
                );
            } catch (err) {
                diagnostics.elapsedMs += Math.max(0, now() - started);
                if (isAbortError(err)) return errorOutcome("timeout", diagnostics);
                diagnostics.providerError = errorMessage(err);
                return errorOutcome("provider_error", diagnostics);
            }
            diagnostics.elapsedMs += Math.max(0, now() - started);

            const text = coerceTextContent(response.content);
            const payloadStr = extractJsonPayload(text);
            if (!payloadStr) {
                lastErrorCode = "parse_failed";
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendParseRetryHint(userPrompt);
                attempt += 1;
                continue;
            }

            const parsed = tolerantJsonParse(payloadStr);
            if (parsed == null) {
                lastErrorCode = "parse_failed";
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendParseRetryHint(userPrompt);
                attempt += 1;
                continue;
            }

            const finalized = finalizeStructuredPayload(parsed, validSegmentIds, diagnostics);
            if (finalized.ok) return finalized.outcome;

            lastZodErrors = finalized.errors;
            lastErrorCode = "schema_invalid";
            diagnostics.schemaErrors = lastZodErrors;
            if (attempt === opts.maxRetries) break;
            currentUserPrompt = appendRetryHint(userPrompt, lastZodErrors);
            attempt += 1;
        }

        return errorOutcome(lastErrorCode, diagnostics);
    }
}

// ---------------------------------------------------------------------------
// Convenience top-level API — keeps callers' import surface flat.
// ---------------------------------------------------------------------------

/**
 * One-shot helper for callers that don't need to keep a model around.
 *
 * Most production callers will construct a `PageletReviewModel` once during
 * adapter setup; this helper exists for tests and for ad-hoc commands.
 */
export async function reviewNote(
    factory: PageletChatModelFactory,
    input: PageletReviewInput,
    options: PageletReviewModelOptions = {},
    signal?: AbortSignal,
): Promise<PageletReviewOutcome> {
    return new PageletReviewModel(factory, options).reviewNote(input, signal);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildMessages(systemPrompt: string, userPrompt: string) {
    return [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)];
}

/**
 * Take a parsed-payload candidate (from either structured output or
 * free-form fallback) and run it through:
 *   1. over-length truncation (row 5)
 *   2. zod validation
 *   3. source_id filtering (row 2 + row 6 partial)
 *   4. empty-suggestions handling (row 4)
 *
 * Returns either a finalized outcome OR a list of zod error strings the
 * caller can feed back into a corrective-retry prompt.
 */
type FinalizeResult =
    | { ok: true; outcome: PageletReviewOutcome }
    | { ok: false; errors: string[] };

function finalizeStructuredPayload(
    raw: unknown,
    validSegmentIds: string[],
    diagnostics: PageletReviewDiagnostics,
): FinalizeResult {
    // Some LangChain versions wrap the result in `{ parsed, raw }` when
    // includeRaw=true; we never request that, but be defensive anyway.
    const candidate =
        raw && typeof raw === "object" && "parsed" in raw && "raw" in raw
            ? (raw as { parsed: unknown }).parsed
            : raw;

    // Some models forget the schema_version. Stamp it before validation so
    // an otherwise-valid suggestion list isn't thrown out for a missing
    // literal — this is intentional schema repair, not laxness; the field
    // is a constant.
    const stampedCandidate = stampDefaultSchemaVersion(candidate);
    const truncation = truncateOverlongFields(stampedCandidate);
    if (truncation.truncated) diagnostics.truncated = true;

    const parseResult = PageletReviewResultSchema.safeParse(truncation.payload);
    if (!parseResult.success) {
        return { ok: false, errors: summarizeZodIssues(parseResult.error) };
    }

    const filtered = filterSuggestionsBySourceIds(parseResult.data.suggestions, validSegmentIds);
    if (filtered.droppedCount > 0) {
        diagnostics.droppedSuggestionsCount += filtered.droppedCount;
        diagnostics.partial = true;
    }

    const finalized: PageletReviewResult = {
        ...parseResult.data,
        suggestions: filtered.suggestions,
    };

    if (finalized.suggestions.length === 0) {
        return {
            ok: true,
            outcome: { status: "empty", result: finalized, diagnostics },
        };
    }
    return { ok: true, outcome: { status: "ok", result: finalized, diagnostics } };
}

function stampDefaultSchemaVersion(payload: unknown): unknown {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const obj = payload as Record<string, unknown>;
    if (obj.schema_version == null) {
        return { ...obj, schema_version: PAGELET_SCHEMA_VERSION };
    }
    return obj;
}

function coerceTextContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((chunk) => {
                if (typeof chunk === "string") return chunk;
                if (chunk && typeof chunk === "object" && "text" in chunk) {
                    const text = (chunk as { text?: unknown }).text;
                    return typeof text === "string" ? text : "";
                }
                return "";
            })
            .join("");
    }
    if (content == null) return "";
    return String(content);
}

function isAbortError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const name = (err as { name?: unknown }).name;
    const code = (err as { code?: unknown }).code;
    return name === "AbortError" || code === "ABORT_ERR";
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try {
        return JSON.stringify(err);
    } catch {
        return "unknown error";
    }
}

function errorOutcome(
    code: PageletReviewErrorCode,
    diagnostics: PageletReviewDiagnostics,
): PageletReviewOutcome {
    return {
        status: "error",
        errorCode: code,
        userMessage: USER_MESSAGES[code],
        diagnostics,
    };
}

function appendRetryHint(originalUserPrompt: string, errors: readonly string[]): string {
    const errorList = errors.length > 0 ? errors.join("; ") : "schema mismatch";
    return [
        originalUserPrompt,
        "",
        "Previous output did not match the schema; fix ONLY the malformed fields and re-emit valid JSON.",
        `Validation errors: ${errorList}`,
        "Remember: every suggestion.source_id MUST equal a provided segment id.",
    ].join("\n");
}

function appendParseRetryHint(originalUserPrompt: string): string {
    return [
        originalUserPrompt,
        "",
        "Previous output could not be parsed as JSON. Re-emit a SINGLE JSON object only — no code fences, no commentary, no trailing commas.",
    ].join("\n");
}

// Re-export schema types for convenience (callers usually want both).
export type {
    PageletReviewInput,
    PageletReviewResult,
    PageletSuggestion,
};
export { PageletReviewInputSchema, PageletReviewResultSchema, PageletSuggestionSchema };

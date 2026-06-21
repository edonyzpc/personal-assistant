/* Copyright 2023 edonyzpc */

/**
 * Pagelet — file IO + frontmatter (Track B · B6).
 *
 * Spec source:
 *  - `docs/archive/review-assistant-sdd.md` §5.1 (directory layout)
 *  - `docs/archive/review-assistant-sdd.md` §5.2 (write via `vault.adapter.write` — R3)
 *  - `docs/archive/review-assistant-sdd.md` §5.3 (frontmatter shape, D029 naming)
 *  - `docs/archive/review-assistant-sdd.md` §5.4 (custom path via settings — D010)
 *  - `docs/archive/review-assistant-decisions.md` D008 (`.pagelet/` dotfolder + collision rule)
 *  - `docs/archive/review-assistant-decisions.md` D009 (filename pattern)
 *  - `docs/archive/review-assistant-decisions.md` D010 (user-configurable path)
 *  - `docs/archive/review-assistant-decisions.md` D025 / D030 (write framework wiring; C1 task)
 *
 * Scope (B6, non-write tracker):
 *  - Resolve a target review-note path given source note + settings + date
 *  - Sanitize awkward source-note names (slashes, Unicode, control chars)
 *  - Serialize the `PageletReviewMetadataSchema` envelope into YAML frontmatter
 *  - Assemble the review-note body (frontmatter + suggestions + remark)
 *  - Persist via `vault.adapter.write` (R3) with on-demand folder creation
 *    and collision-safe filename minting
 *
 * Out-of-scope (deferred to C1 / framework integration):
 *  - Registering this writer as a `WriteActionCapability` on the
 *    `CapabilityProvider`. The exported API surface (`writeReviewNote`) is
 *    intentionally shaped to slot under `WriteActionCapability.executeWrite`
 *    without re-plumbing: the framework wrapper will call this function
 *    after target-confinement / preview / stale-reread gates, supplying the
 *    `markSelfWrite` hook via `options.markSelfWrite`.
 *
 * Design choices worth flagging:
 *  - YAML serialization is hand-rolled (no `stringifyYaml` import). The
 *    `PageletReviewMetadataSchema` is intentionally flat with only string /
 *    number / boolean scalars, so a 40-line printer is safer than dragging
 *    in the obsidian runtime export (which the jest mock doesn't expose).
 *    If a future schema bump introduces nested structures, switch to
 *    obsidian's `stringifyYaml` and extend the mock.
 *  - Collision-handling appends a `-2`, `-3`, … suffix (SDD §5.3 leaves the
 *    exact knob unspecified; this matches D008's "same day, multiple reviews"
 *    intent without leaking time-of-day into filenames). After 99 attempts
 *    we fall back to an HHMMSS timestamp suffix to avoid pathological loops.
 *  - Path resolution lives in a pure helper (`resolveReviewNotePath`) so
 *    tests can exercise sanitize / date / folder rules without mocking IO.
 */

import { normalizePath } from "obsidian";

import type { PageletSettings } from "../settings/pagelet";

import {
    PAGELET_SCHEMA_VERSION,
    PageletReviewMetadataSchema,
    type PageletLanguageCode,
    type PageletReviewMetadata,
    type PageletReviewResult,
} from "./pa-review-schemas";

// ---------------------------------------------------------------------------
// Constants — exported for downstream callers / tests
// ---------------------------------------------------------------------------

/**
 * Default review folder (mirrors `PAGELET_DEFAULTS.reviewsFolder`). Re-exported
 * here so file-IO callers don't have to import the settings module just to
 * recover the default.
 */
export const PAGELET_DEFAULT_REVIEWS_FOLDER = ".pagelet" as const;

/**
 * Collision-handling fallback after `MAX_COLLISION_SUFFIX` attempts. Stays
 * inside the same minute window so multiple beta-test users producing rapid
 * reviews on the same source note don't generate visually-similar filenames.
 */
export const MAX_COLLISION_SUFFIX = 99 as const;

/**
 * Filename suffix used between sanitized base name and date. Kept as a
 * constant so a future bump (e.g. `pagelet-review` → `pagelet-rev`) is a
 * single edit; D009's pattern is exported here as the source of truth.
 */
export const PAGELET_FILENAME_INFIX = "pagelet-review" as const;

/**
 * Character class used by `sanitizeSourceBaseName`. Declared via
 * `RegExp(...)` rather than a literal to keep the source bytes printable
 * (some lint hooks rewrite raw control bytes inside regex literals).
 *
 * The class members are:
 *  - `\\\\` `/` `:` `*` `?` `"` `<` `>` `|` → Windows / Obsidian reserved
 *  - `\\s` → spaces / tabs (CLI-tool friendliness; Obsidian itself tolerates spaces)
 *  - `\\u0000-\\u001F` + `\\u007F` → ASCII control characters + DEL
 */
/* eslint-disable no-control-regex */
const SOURCE_NAME_FORBIDDEN_CHARS = new RegExp(
    "[\\\\/:*?\"<>|\\s\\u0000-\\u001F\\u007F]",
    "g",
);
/* eslint-enable no-control-regex */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of `Vault['adapter']` we actually use. Defining a structural type
 * (rather than importing `DataAdapter`) keeps test mocks lightweight and
 * documents the exact methods this module touches.
 */
export interface PageletReviewIOAdapter {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    write(path: string, data: string): Promise<void>;
}

/**
 * Subset of `App['vault']` we need; using a structural type avoids pulling
 * the whole Obsidian Vault into the test harness. Production callers pass
 * `plugin.app.vault` directly — TypeScript widens automatically because the
 * real `Vault.adapter` extends `PageletReviewIOAdapter`.
 */
export interface PageletReviewVaultLike {
    adapter: PageletReviewIOAdapter;
}

/**
 * Settings slice this module needs. Extracted into its own type so callers
 * outside of `PageletSettings` (e.g. ad-hoc CLI scripts) can pass a literal.
 */
export type PageletReviewFileIOSettings = Pick<PageletSettings, "reviewsFolder">;

/**
 * Inputs to `resolveReviewNotePath`. Pure — no IO, no async.
 */
export interface ResolveReviewNotePathInput {
    /** Source note vault-relative path (any sanitization happens internally). */
    sourcePath: string;
    /** Settings slice; `reviewsFolder` selects the target folder. */
    settings: PageletReviewFileIOSettings;
    /**
     * Date used for the `YYYY-MM-DD` filename component. Caller injects so
     * the writer can produce deterministic snapshots in tests and so a
     * future "schedule for tomorrow" feature can override.
     */
    date: Date;
    /**
     * Optional collision suffix counter. `0` (default) yields the bare
     * `{base}-pagelet-review-{date}.md`; `1` → `-2`, `2` → `-3`, …
     */
    collisionIndex?: number;
}

/**
 * Inputs to `writeReviewNote`. The shape mirrors what
 * `WriteActionCapability.executeWrite` will receive (C1 wiring):
 *  - `input` slot          → `{ sourcePath, reviewResult, dateOverride }`
 *  - `context` slot        → `{ vault, settings, ... }`
 *  - `hooks` slot          → `{ markSelfWrite }` (Framework provides; B6 leaves blank)
 *
 * Production callers can build their own `WriteActionCapability` adapter
 * that translates `input + context + hooks` into this call without changing
 * either side. See the C1 task description in `docs/sdd-rollout-plan.md` §4.4.
 */
export interface WriteReviewNoteInput {
    /** Source note vault-relative path (used for filename + frontmatter). */
    sourcePath: string;
    /** LLM-validated review result (B1 schema). */
    reviewResult: PageletReviewResult;
    /** Settings slice — selects target folder + custom path overrides. */
    settings: PageletReviewFileIOSettings;
    /** Vault-like accessor; production code passes `plugin.app.vault`. */
    vault: PageletReviewVaultLike;
    /**
     * "basic" or "deeper" — surfaces in frontmatter for downstream
     * filtering (e.g. "show only deeper reviews from the past week").
     */
    mode: PageletReviewMetadata["pagelet_mode"];
    /** Detected note language (B1 D015). */
    detectedLanguage: PageletLanguageCode;
    /**
     * Vault-relative path already shown in preview and accepted by the user.
     * When present, the writer MUST use this exact path and MUST NOT remint a
     * collision suffix during execute.
     */
    targetPath?: string;
    /**
     * Optional injected date — defaults to `new Date()`. Tests use this
     * for deterministic filenames; future "scheduled reviews" can leverage.
     */
    dateOverride?: Date;
    /** Optional cost recorded for this review (D022). */
    costUsd?: number;
    /** Optional provider id (e.g. "qwen", "openai") for frontmatter. */
    provider?: string;
    /** Optional model id (e.g. "qwen-plus") for frontmatter. */
    model?: string;
    /**
     * C1 wiring hook — when the framework runs us, it passes this so the
     * adapter can register the upcoming `.pagelet/...` write as a
     * self-write (preventing the modify-event listener from re-triggering
     * our own writer; see framework SDD §3 + R3).
     *
     * B6 leaves this `undefined`; C1 will populate from `WriteActionExecuteHooks`.
     */
    markSelfWrite?: (path: string) => void;
    /**
     * Injectable ISO-8601 timestamp generator for `pagelet_created_at`.
     * Defaults to a `+00:00` (UTC) formatter so tests are TZ-stable; the
     * production path uses the same formatter — review notes don't need
     * the user's local offset embedded.
     */
    nowIso?: () => string;
}

/**
 * Result returned by `writeReviewNote`. `created === true` means the file
 * did not previously exist; `false` only occurs when the caller forces an
 * overwrite (not currently supported — collision handling always picks a
 * fresh suffix).
 */
export interface WriteReviewNoteResult {
    /** Final vault-relative path the note was written to. */
    path: string;
    /** True for the new-file path (always true for new-file writes; reserved for future overwrites). */
    created: boolean;
    /** The frontmatter envelope that was serialized (returned for telemetry / tests). */
    metadata: PageletReviewMetadata;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Format a `Date` as `YYYY-MM-DD` using UTC components.
 *
 * Why UTC: the date suffix is part of a filename, not a user-visible field;
 * embedding the user's TZ would (a) produce drift across devices that sync
 * the same vault and (b) cause "the note disappeared at midnight" bugs.
 * Users who want their local date can still inject via `dateOverride`.
 */
export function formatPageletDate(date: Date): string {
    const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a `Date` as ISO-8601 with a literal `+00:00` offset (NOT `Z`).
 *
 * The SDD §5.3 sample uses `+08:00`; we explicitly NORMALISE to UTC so the
 * stored timestamp is unambiguous across devices syncing the vault. Using
 * `+00:00` (rather than `Z`) matches the SDD's stated offset-bearing form
 * literally and avoids tripping naive ISO regexes that allow trailing
 * `[+-]HH:MM` but not the bare `Z` suffix.
 */
export function formatPageletIsoTimestamp(date: Date): string {
    const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mi = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+00:00`;
}

/**
 * Strip the source path down to a filename-safe stem.
 *
 * Rules (in order):
 *  1. Drop `.md` (or any single trailing extension) — review note has its
 *     own date suffix; chaining `.md.md` is noise.
 *  2. Drop leading directory components — review notes live flat in
 *     `.pagelet/`, mirroring the source's folder tree would create a
 *     parallel hierarchy users didn't ask for.
 *  3. Replace path separators, control chars, and the Obsidian-reserved
 *     set (`\\ / : * ? " < > |`) with `_`. Spaces are preserved (Obsidian
 *     handles them fine and they help readability).
 *  4. Collapse runs of `_` and trim leading/trailing `_` / `.` so the stem
 *     is unambiguous.
 *  5. If sanitization yields an empty stem (e.g. caller passed `///`),
 *     fall back to `pagelet-note`.
 *
 * Unicode (CJK, emoji, etc.) is preserved — Obsidian + every modern FS we
 * target supports it, and surrogate-mangling would be a bigger UX hit than
 * occasional sync hiccups on legacy iCloud paths.
 */
export function sanitizeSourceBaseName(sourcePath: string): string {
    if (typeof sourcePath !== "string") return "pagelet-note";
    let raw = sourcePath.trim();
    if (raw.length === 0) return "pagelet-note";

    // (2) drop directory prefix — keep the last `/`-segment only.
    const lastSlash = raw.lastIndexOf("/");
    if (lastSlash >= 0) raw = raw.slice(lastSlash + 1);
    const lastBackslash = raw.lastIndexOf("\\");
    if (lastBackslash >= 0) raw = raw.slice(lastBackslash + 1);

    // (1) drop a single trailing extension (.md / .mdx / .markdown / etc.)
    raw = raw.replace(/\.[A-Za-z0-9]{1,8}$/, "");

    // (3) replace reserved + whitespace + control characters with `_`. We
    // list the Windows-reserved set explicitly so the same sanitized name
    // works across iCloud (case-insensitive) and Windows-mounted vaults.
    // \s catches spaces / tabs (which Obsidian tolerates but command-line
    // tooling stumbles on), and the explicit u0000-u001F range covers
    // every ASCII control character. We intentionally do NOT strip `.`
    // from inside the stem — many users have notes like
    // `RFC-2026.06.02.md`.
    raw = raw.replace(SOURCE_NAME_FORBIDDEN_CHARS, "_");

    // (4) collapse and trim
    raw = raw.replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "");

    return raw.length > 0 ? raw : "pagelet-note";
}

/**
 * Resolve the user's configured `reviewsFolder` setting to a vault-relative
 * POSIX path the IO layer can hand to `vault.adapter.*`. Defers to
 * Obsidian's `normalizePath` so behaviour matches other adapter call sites
 * in the plugin, then strips trailing slashes (the SDD stores paths as
 * `.pagelet`, not `.pagelet/`).
 *
 * Falls back to `PAGELET_DEFAULT_REVIEWS_FOLDER` when the input is empty,
 * non-string, or normalizes to `/` — none of which represent a usable
 * vault-relative folder.
 *
 * This is purely a path resolver — it assumes the settings layer's
 * `normalizeReviewsFolder` (in `src/settings/pagelet/index.ts`) has already
 * fail-closed any forbidden shapes (`.obsidian/...`, absolute, traversal,
 * control chars, …). Do NOT call this on raw user input.
 */
export function resolveReviewsFolderPath(value: unknown): string {
    if (typeof value !== "string") return PAGELET_DEFAULT_REVIEWS_FOLDER;
    const trimmed = value.trim();
    if (trimmed.length === 0) return PAGELET_DEFAULT_REVIEWS_FOLDER;
    const normalized = normalizePath(trimmed.replace(/^\.?\/+/, "").replace(/\/+$/, ""));
    if (!normalized || normalized === "/" || normalized === ".") {
        return PAGELET_DEFAULT_REVIEWS_FOLDER;
    }
    return normalized;
}

/**
 * @deprecated Use {@link resolveReviewsFolderPath} — kept as an alias so the
 * locked `pa-review-tool-provider.ts` import continues to compile while
 * callers migrate to the new name. Will be removed once the locked file is
 * editable again.
 */
export const normalizeReviewsFolder = resolveReviewsFolderPath;

/**
 * Pure path-resolver — produces the deterministic `.pagelet/<stem>-pagelet-review-<date>.md`
 * candidate path for the given inputs. Collision detection lives in
 * `writeReviewNote` (it needs `adapter.exists`); this function only computes
 * the candidate the IO layer will probe.
 */
export function resolveReviewNotePath(input: ResolveReviewNotePathInput): string {
    const folder = resolveReviewsFolderPath(input.settings.reviewsFolder);
    const stem = sanitizeSourceBaseName(input.sourcePath);
    const date = formatPageletDate(input.date);
    const suffix = input.collisionIndex && input.collisionIndex > 0
        ? `-${input.collisionIndex + 1}`
        : "";
    return normalizePath(`${folder}/${stem}-${PAGELET_FILENAME_INFIX}-${date}${suffix}.md`);
}

/**
 * Async path resolver for callers that need to freeze the exact write target
 * before preview. The returned path is non-colliding at the time of probing;
 * the Write Action Framework re-checks it immediately before execute.
 */
export async function mintNonCollidingReviewNotePath(args: {
    adapter: PageletReviewIOAdapter;
    sourcePath: string;
    settings: PageletReviewFileIOSettings;
    date?: Date;
}): Promise<string> {
    return mintNonCollidingPath({
        adapter: args.adapter,
        sourcePath: args.sourcePath,
        settings: args.settings,
        date: args.date ?? new Date(),
    });
}

// ---------------------------------------------------------------------------
// Frontmatter / body serialization
// ---------------------------------------------------------------------------

/**
 * Build the `PageletReviewMetadata` envelope from the writer inputs. Kept
 * separate so tests can validate the envelope without exercising the IO
 * layer, and so a future C1 wiring can run schema validation upstream
 * without re-deriving fields.
 *
 * Throws (via `zod.parse`) if the envelope fails schema validation — that's
 * a programmer error worth surfacing loudly rather than swallowing.
 */
export function buildReviewMetadata(input: {
    sourcePath: string;
    mode: PageletReviewMetadata["pagelet_mode"];
    detectedLanguage: PageletLanguageCode;
    createdAtIso: string;
    costUsd?: number;
    provider?: string;
    model?: string;
}): PageletReviewMetadata {
    const candidate: PageletReviewMetadata = {
        pagelet: true,
        pagelet_schema_version: PAGELET_SCHEMA_VERSION,
        pagelet_source: input.sourcePath,
        pagelet_created_at: input.createdAtIso,
        pagelet_mode: input.mode,
        pagelet_detected_language: input.detectedLanguage,
        ...(typeof input.costUsd === "number" ? { pagelet_cost_usd: input.costUsd } : {}),
        ...(input.provider ? { pagelet_provider: input.provider } : {}),
        ...(input.model ? { pagelet_model: input.model } : {}),
    };
    return PageletReviewMetadataSchema.parse(candidate);
}

/**
 * Hand-rolled YAML serializer for the constrained frontmatter envelope.
 *
 * The schema is enforced upstream (`PageletReviewMetadataSchema.parse`), so
 * we know every value is a string, number, or boolean — no nested objects,
 * no arrays, no nulls. That lets us emit each row as `key: value` with
 * minimal escaping.
 *
 * Quoting rules:
 *  - booleans / numbers / known-safe scalars → bare emit
 *  - strings that contain only `[A-Za-z0-9_\-./+]` and don't look like
 *    YAML 1.1 booleans (`yes`/`no`/`true`/`false`/`on`/`off`) → bare emit
 *  - everything else → JSON-encoded (double-quoted with proper escapes)
 *
 * JSON encoding is YAML-1.1-compatible (JSON is a strict subset of YAML
 * 1.2 and round-trips through YAML 1.1 parsers as a "flow scalar" without
 * loss), so we get correct escaping for free.
 */
export function serializeFrontmatter(metadata: PageletReviewMetadata): string {
    const lines: string[] = ["---"];
    // Iterate over a fixed key order so the output is byte-stable across
    // runs (which matters for test snapshots and for users who diff their
    // review folder under git).
    const orderedKeys: (keyof PageletReviewMetadata)[] = [
        "pagelet",
        "pagelet_schema_version",
        "pagelet_source",
        "pagelet_created_at",
        "pagelet_mode",
        "pagelet_cost_usd",
        "pagelet_detected_language",
        "pagelet_provider",
        "pagelet_model",
    ];
    for (const key of orderedKeys) {
        const value = metadata[key];
        if (value === undefined) continue;
        lines.push(`${key}: ${serializeYamlScalar(value)}`);
    }
    lines.push("---");
    return lines.join("\n");
}

function serializeYamlScalar(value: boolean | number | string): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
        // Number.isFinite eliminates NaN / Infinity; schema rejects these
        // upstream but a defensive check is cheap insurance against future
        // schema relaxations.
        if (!Number.isFinite(value)) return JSON.stringify(String(value));
        return String(value);
    }
    if (looksLikeSafeYamlBareString(value)) return value;
    return JSON.stringify(value);
}

const YAML_RESERVED_WORDS = new Set([
    "true",
    "false",
    "yes",
    "no",
    "on",
    "off",
    "null",
    "~",
]);

function looksLikeSafeYamlBareString(value: string): boolean {
    if (value.length === 0) return false;
    if (YAML_RESERVED_WORDS.has(value.toLowerCase())) return false;
    // Bare-safe = printable ASCII letters/digits + a small set of
    // delimiter-free punctuation. Anything else (spaces, colons, quotes,
    // CJK, emoji, control chars) takes the JSON-escape branch.
    if (!/^[A-Za-z0-9_\-./+]+$/.test(value)) return false;
    // Leading characters that would make YAML parse the value as another
    // node type: `-` (list item), `?` (mapping), `&`/`*` (anchor/alias),
    // `!` (tag). The regex above already excludes these, but we keep the
    // explicit guard to document intent and survive regex tweaks.
    if (/^[-?&*!]/.test(value)) return false;
    return true;
}

/**
 * Render the review-note body (markdown after frontmatter). The format is
 * intentionally close to what B2's SuggestionCard renders inline so users
 * who copy a stored review back into a chat see a familiar layout.
 *
 * The choice of headings (`## Suggestions`, `## Overall remark`) matches
 * the SuggestionCard region labels (B2); keeping the markdown stable means
 * a future "open in card" command can re-hydrate without parsing.
 */
export function renderReviewBody(result: PageletReviewResult): string {
    const lines: string[] = [];
    const heading = result.detected_language === "zh" ? "## 建议" : "## Suggestions";
    lines.push(heading, "");
    if (result.suggestions.length === 0) {
        const empty = result.detected_language === "zh"
            ? "_本次审阅未发现需要改进的点。_"
            : "_No suggestions for this review._";
        lines.push(empty, "");
    } else {
        for (let i = 0; i < result.suggestions.length; i++) {
            const s = result.suggestions[i];
            lines.push(`### ${i + 1}. ${s.kind} — \`${s.source_id}\``);
            lines.push("");
            const rationaleLabel = result.detected_language === "zh" ? "**理由**" : "**Rationale**";
            const actionLabel = result.detected_language === "zh" ? "**建议**" : "**Proposed action**";
            lines.push(`${rationaleLabel}: ${s.rationale}`);
            lines.push("");
            lines.push(`${actionLabel}: ${s.proposed_action}`);
            if (s.related_notes && s.related_notes.length > 0) {
                lines.push("");
                const relatedLabel = result.detected_language === "zh" ? "**相关笔记**" : "**Related notes**";
                const items = s.related_notes.map((n) => `- [[${n}]]`).join("\n");
                lines.push(`${relatedLabel}:`, items);
            }
            lines.push("");
        }
    }
    if (result.overall_remark) {
        const remarkHeading = result.detected_language === "zh" ? "## 总体评价" : "## Overall remark";
        lines.push(remarkHeading, "", result.overall_remark, "");
    }
    return lines.join("\n");
}

/**
 * Assemble the full note: frontmatter + blank line + body. Exported because
 * a future "preview" surface (framework Gate 2) can show users exactly what
 * will be written before the IO call happens.
 */
export function assembleReviewNote(
    metadata: PageletReviewMetadata,
    result: PageletReviewResult,
): string {
    return `${serializeFrontmatter(metadata)}\n\n${renderReviewBody(result)}`.trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// IO entry point
// ---------------------------------------------------------------------------

/**
 * Persist a review note. Returns the final path + the metadata envelope.
 *
 * IO flow (matches SDD §5.2 R3):
 *  1. Normalize the target folder; recursively `mkdir` any missing segment.
 *  2. Compute the base candidate path via `resolveReviewNotePath`.
 *  3. Probe `adapter.exists`; on collision, mint `-2`, `-3`, … (up to
 *     `MAX_COLLISION_SUFFIX`), then fall back to an HHMMSS timestamp.
 *  4. Build + validate the frontmatter envelope.
 *  5. Call `markSelfWrite(finalPath)` if the C1 hook was provided.
 *  6. `adapter.write(finalPath, body)`.
 *
 * Errors:
 *  - `mkdir` / `write` failures propagate verbatim — the framework wrapper
 *    is responsible for surfacing them as user-visible errors and emitting
 *    `execute.fail` debug events.
 *  - `adapter.exists` failures during collision probing also propagate; we
 *    intentionally don't swallow them because a corrupt index would
 *    otherwise lead to silent overwrites.
 */
export async function writeReviewNote(
    input: WriteReviewNoteInput,
): Promise<WriteReviewNoteResult> {
    const date = input.dateOverride ?? new Date();
    const finalPath = input.targetPath
        ? normalizePath(input.targetPath)
        : await mintNonCollidingPath({
            adapter: input.vault.adapter,
            sourcePath: input.sourcePath,
            settings: input.settings,
            date,
        });
    const folder = folderFromPath(finalPath) ?? resolveReviewsFolderPath(input.settings.reviewsFolder);

    await ensureFolder(input.vault.adapter, folder);

    if (await input.vault.adapter.exists(finalPath)) {
        throw new Error(`Pagelet review target already exists: ${finalPath}`);
    }

    const nowIso = input.nowIso ? input.nowIso() : formatPageletIsoTimestamp(date);
    const metadata = buildReviewMetadata({
        sourcePath: input.sourcePath,
        mode: input.mode,
        detectedLanguage: input.detectedLanguage,
        createdAtIso: nowIso,
        costUsd: input.costUsd,
        provider: input.provider,
        model: input.model,
    });

    const body = assembleReviewNote(metadata, input.reviewResult);

    // R3 wiring point — invoked BEFORE the actual write so framework's
    // modify-event listener can short-circuit when it sees this path.
    input.markSelfWrite?.(finalPath);

    await input.vault.adapter.write(finalPath, body);

    return {
        path: finalPath,
        created: true,
        metadata,
    };
}

// ---------------------------------------------------------------------------
// Internal IO helpers
// ---------------------------------------------------------------------------

/**
 * Walk the `folder` path one segment at a time, `mkdir`ing missing nodes.
 * Mirrors `stats-sync-store.ts:ensureFolder` so the behaviour is consistent
 * across the plugin (an existing folder is a no-op; the only async cost is
 * the `exists` probes).
 */
async function ensureFolder(
    adapter: PageletReviewIOAdapter,
    folder: string,
): Promise<void> {
    const parts = normalizePath(folder).split("/").filter(Boolean);
    let current = "";
    for (const segment of parts) {
        current = current ? `${current}/${segment}` : segment;
        if (!(await adapter.exists(current))) {
            await adapter.mkdir(current);
        }
    }
}

async function mintNonCollidingPath(args: {
    adapter: PageletReviewIOAdapter;
    sourcePath: string;
    settings: PageletReviewFileIOSettings;
    date: Date;
}): Promise<string> {
    for (let i = 0; i <= MAX_COLLISION_SUFFIX; i++) {
        const candidate = resolveReviewNotePath({
            sourcePath: args.sourcePath,
            settings: args.settings,
            date: args.date,
            collisionIndex: i,
        });
        if (!(await args.adapter.exists(candidate))) return candidate;
    }
    // Fallback after 100 collisions on the same day for the same source
    // note: append HHMMSS so we still produce a fresh name without an
    // unbounded `-N` chain. This is pathological-territory; the SDD's
    // ".pagelet folder per source note per day" assumption breaks down
    // long before we reach here.
    const folder = resolveReviewsFolderPath(args.settings.reviewsFolder);
    const stem = sanitizeSourceBaseName(args.sourcePath);
    const date = formatPageletDate(args.date);
    const time = formatHmsSuffix(args.date);
    return normalizePath(
        `${folder}/${stem}-${PAGELET_FILENAME_INFIX}-${date}-${time}.md`,
    );
}

function formatHmsSuffix(date: Date): string {
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${hh}${mm}${ss}`;
}

function folderFromPath(path: string): string | null {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) return null;
    return normalized.substring(0, lastSlash);
}

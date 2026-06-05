/**
 * Target Confinement Module (Gate 1) — framework SDD §2.2.
 *
 * Deterministic, fail-closed path validation for write actions. Runs **before**
 * preview rendering so LLM-produced paths that escape allowlist never reach the
 * user-facing modal.
 *
 * Two-stage API:
 *   - `validateTargetConfinementSync(candidate, config)` — pure string-only checks
 *     (normalize / allowlist / parent traversal / control chars / extension / length).
 *     Suitable for unit tests with no FS dependency.
 *   - `validateTargetConfinement(candidate, config, fs?)` — async wrapper that
 *     additionally probes folder existence and target collision via the supplied
 *     `ConfinementFsProbe`. Used by the runtime ActionExecutor.
 *
 * Reject reasons are categorized (not a single generic "invalid") so the runtime
 * can emit precise `gate.target-confinement.reject` debug events for triage.
 */

import type { ConfinementConfig } from "./types";

export type ConfinementRejectReason =
    | "empty_path"
    | "absolute_path"
    | "drive_letter"
    | "parent_traversal"
    | "control_char"
    | "invisible_chars"
    | "trailing_dot_or_space"
    | "forbidden_dotfolder"
    | "outside_allowlist"
    | "bad_extension"
    | "path_too_long"
    | "custom_pattern_rejected"
    | "name_collision"
    | "folder_missing";

/**
 * Top-level path segments that must never be written into, regardless of what
 * `allowedRoots` the caller supplies. Mirrors the same set checked by the
 * settings-layer validator at `src/settings/pagelet/index.ts` (`FORBIDDEN_DOTFOLDER_SEGMENTS`
 * + the `obsidian_config` literal); kept here as defense-in-depth so a caller
 * with a misconfigured allowlist — or a future caller wired without a
 * settings-layer scrub — still fails closed. Membership test is performed
 * after NFC + lowercase folding so APFS / NTFS case-insensitive dispatch
 * (`.Obsidian`, `.OBSIDIAN.bak`) and NFD variants do not bypass the guard.
 */
const FORBIDDEN_DOTFOLDER_SEGMENTS: ReadonlySet<string> = new Set([
    ".obsidian",
    ".git",
    ".trash",
    ".obsidian.bak",
]);

/**
 * Cf-category invisible characters used for identifier spoofing — ZWSP/ZWNJ/ZWJ
 * (U+200B-U+200D), WJ (U+2060), BOM/ZWNBSP (U+FEFF), LRM/RLM (U+200E/U+200F),
 * bidi-formats (U+202A-U+202E), bidi-isolates (U+2066-U+2069). Pattern is
 * verbatim-equal to the settings-layer source at
 * `src/settings/pagelet/index.ts:287` so a future audit can grep both sides
 * and confirm parity. Rejects e.g. a path with a leading ZWSP before
 * `.obsidian` (visually reads `.obsidian/...` but bypasses the literal
 * segment-equality check below).
 *
 * NFC residual risk (issue #360 Option A): fullwidth lookalikes like
 * U+FF0E + fullwidth letters survive both this check and the NFC +
 * lowercase fold path used by `FORBIDDEN_DOTFOLDER_SEGMENTS`. Acceptable
 * today because Obsidian / APFS / NTFS dispatch rules don't fold fullwidth
 * → ASCII. If that ever changes, upgrade BOTH this layer AND the
 * settings-layer fold to NFKC in lock-step (see SDD §2.2 note).
 */
const INVISIBLE_CHARS_RE =
    /[\u200b-\u200d\u2060\ufeff\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * Trailing dot or whitespace per segment. NTFS silently strips trailing `.` /
 * space at the OS layer, so `.obsidian./plugins/x.md` dispatches to the real
 * `.obsidian/plugins/x.md` despite the literal segment guard below seeing
 * `.obsidian.` (not equal to `.obsidian`). Same class of bypass for trailing
 * tab/NBSP via `\s`. Verbatim copy of the settings-layer pattern at
 * `src/settings/pagelet/index.ts:330`.
 */
const TRAILING_DOT_OR_SPACE_RE = /[.\s]$/;

export type ConfinementResult =
    | { ok: true; normalizedPath: string }
    | { ok: false; reason: ConfinementRejectReason; detail?: string };

/**
 * Construction-time validation failure thrown by {@link validateAllowedRoots}.
 * Loud signal (per issue #358 AC) so a misconfigured `allowedRoots` cannot be
 * silently coerced through the candidate-side check at write time. Caught
 * upstream by capability registration code or surfaced as plugin-init failure.
 */
export class ConfinementConfigError extends Error {
    readonly reason: ConfinementRejectReason;
    readonly offendingRoot: string;
    readonly offendingSegment: string;
    constructor(
        reason: ConfinementRejectReason,
        offendingRoot: string,
        offendingSegment: string,
        message?: string,
    ) {
        super(message ?? `allowedRoots entry "${offendingRoot}" rejected: ${reason} (segment "${offendingSegment}")`);
        this.name = "ConfinementConfigError";
        this.reason = reason;
        this.offendingRoot = offendingRoot;
        this.offendingSegment = offendingSegment;
    }
}

/**
 * Construction-time validation of `allowedRoots` (framework SDD §2.2 / issue
 * #358 AC #1). Throws {@link ConfinementConfigError} when any root's
 * top-level segment — after backslash normalization, NFC, and lowercase
 * fold — is in {@link FORBIDDEN_DOTFOLDER_SEGMENTS}. Runs at
 * `buildConfinement` time so a misconfigured caller fails LOUDLY at
 * capability registration, not silently at first write. Mirrors the
 * candidate-side denylist in {@link validateTargetConfinementSync} step 9:
 * both sides reject the same input set so the framework remains a true
 * second line of defense regardless of caller wiring. Step numbers throughout
 * track SDD §2.2's 1–13 sync sequence (steps 14–15 are async folder/collision
 * probes that only the {@link validateTargetConfinement} wrapper runs).
 */
export function validateAllowedRoots(allowedRoots: readonly string[]): void {
    for (const root of allowedRoots) {
        if (typeof root !== "string" || root.length === 0) continue;

        // Mirror sync step 2: control_char on raw root, before any normalization.
        // Catches NUL / 0x01–0x1F smuggled into the allowlist at construction
        // time so a misconfigured caller cannot slip past the candidate-side
        // guard via a sanitizer that strips control chars from the candidate
        // but trusts the root verbatim.
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x1f]/.test(root)) {
            throw new ConfinementConfigError("control_char", root, root);
        }

        // Mirror sync step 3: invisible_chars on raw root, before any
        // normalization. Surface the offending root unchanged so a maintainer
        // can paste it back into a hex inspector if the byte is non-printable.
        if (INVISIBLE_CHARS_RE.test(root)) {
            throw new ConfinementConfigError("invisible_chars", root, root);
        }

        // Mirror sync step 4: absolute_path. A root anchored at filesystem
        // root would let any candidate that prefix-matches it escape the vault.
        if (root.startsWith("/")) {
            throw new ConfinementConfigError("absolute_path", root, root);
        }

        // Mirror sync step 5: drive_letter (Windows). Same escape-the-vault
        // concern as absolute_path on POSIX.
        if (/^[a-zA-Z]:/.test(root)) {
            throw new ConfinementConfigError("drive_letter", root, root);
        }

        // Mirror sync step 6: same normalize shape on both sides (backslash →
        // `/`, strip leading `./`, collapse repeated `//`). The `/+/g` collapse
        // is load-bearing — without it `notes//foo/` splits to
        // `["notes", "", "foo", ""]` and a future segment check that forgets to
        // skip empties would either misreport or silently let bad input through.
        const normalized = root
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/\/+/g, "/");
        const segments = normalized.split("/");

        // Mirror sync step 7: parent traversal. Any literal `..` segment
        // would route an allowlist-anchored write outside the vault root,
        // so reject before checking trailing-char shapes (otherwise the
        // `..` ends-in-dot property reports the wrong reason).
        if (segments.some((segment) => segment === "..")) {
            throw new ConfinementConfigError("parent_traversal", root, "..");
        }

        // Mirror sync step 8: trailing dot/space per segment. After the `/+/g`
        // collapse above, the only empty segment that can survive is the
        // terminal one from a legitimate trailing slash (e.g. `.pagelet/`
        // splits to `[".pagelet", ""]`), so `length > 0` is a convention guard,
        // not a normalization workaround.
        for (const segment of segments) {
            if (segment.length > 0 && TRAILING_DOT_OR_SPACE_RE.test(segment)) {
                throw new ConfinementConfigError("trailing_dot_or_space", root, segment);
            }
        }

        const firstSegment = segments[0] ?? "";
        const folded = firstSegment.normalize("NFC").toLowerCase();
        if (FORBIDDEN_DOTFOLDER_SEGMENTS.has(folded)) {
            throw new ConfinementConfigError("forbidden_dotfolder", root, firstSegment);
        }
    }
}

/**
 * Filesystem probe used by the async {@link validateTargetConfinement} wrapper
 * to check folder existence and target collision. Adapter shape is intentionally
 * narrow so callers can pass either Obsidian's `vault.adapter` (which already
 * implements `exists`) or a mock in tests.
 */
export interface ConfinementFsProbe {
    exists(path: string): Promise<boolean>;
}

/** Framework default max path length (framework SDD §2.2). */
export const DEFAULT_MAX_PATH_LENGTH = 200;

/**
 * Pure sync validation. Categorized checks run in fixed order so the first
 * concrete reason wins (e.g., an absolute path containing control chars
 * reports `absolute_path` first).
 *
 * Order: empty → control_char → invisible_chars → absolute → drive_letter →
 *        normalize → parent_traversal → trailing_dot_or_space →
 *        forbidden_dotfolder → length → allowlist → extension →
 *        custom rejectPatterns.
 */
export function validateTargetConfinementSync(
    candidate: string,
    config: ConfinementConfig,
): ConfinementResult {
    if (candidate === null || candidate === undefined) {
        return { ok: false, reason: "empty_path", detail: "candidate is null/undefined" };
    }
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.trim() === "") {
        return { ok: false, reason: "empty_path" };
    }

    // 2. Control characters (NUL through 0x1F). Detect on raw input before any
    // normalization to catch payloads that try to smuggle bytes past trim/replace.
    // (Step 1 — empty/whitespace — is the two `empty_path` returns above.)
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(candidate)) {
        return { ok: false, reason: "control_char" };
    }

    // 3. Cf-category invisible chars (ZWSP/ZWNJ/ZWJ, WJ, BOM, LRM/RLM,
    // bidi-isolates). Raw-input check so a ZWSP prefix on `.obsidian` is
    // rejected here instead of leaking through to the segment-equality check
    // that wouldn't match the spoofed string. Mirror of settings-layer
    // `src/settings/pagelet/index.ts:287`.
    if (INVISIBLE_CHARS_RE.test(candidate)) {
        return { ok: false, reason: "invisible_chars" };
    }

    // 4. Absolute path (POSIX-style leading "/").
    if (candidate.startsWith("/")) {
        return { ok: false, reason: "absolute_path" };
    }

    // 5. Windows drive letter (e.g., "C:/...", "c:\..."). Catch before normalize.
    if (/^[a-zA-Z]:/.test(candidate)) {
        return { ok: false, reason: "drive_letter" };
    }

    // 6. Normalize: convert backslashes to forward slashes (Obsidian uses POSIX
    // separators), strip leading "./", collapse repeated "//".
    let normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
    // Strip a trailing slash so extension check has a real filename to inspect.
    if (normalized.endsWith("/") && normalized.length > 1) {
        normalized = normalized.slice(0, -1);
    }

    // 7. Parent traversal: any segment equal to ".." (covers "../x", "a/../b", "a/..").
    const segments = normalized.split("/");
    if (segments.some((segment) => segment === "..")) {
        return { ok: false, reason: "parent_traversal" };
    }

    // 8. Trailing dot or whitespace per segment. MUST run before the
    // forbidden_dotfolder check below — otherwise `.obsidian./plugins/x.md`
    // would slip past the segment-equality fold (`.obsidian.` ≠ `.obsidian`)
    // and only NTFS would stop it at OS layer (which it does silently, by
    // dispatching the write into the real `.obsidian/`). Mirror of
    // settings-layer `src/settings/pagelet/index.ts:330`.
    const trailingOffender = segments.find((segment) => TRAILING_DOT_OR_SPACE_RE.test(segment));
    if (trailingOffender !== undefined) {
        return { ok: false, reason: "trailing_dot_or_space", detail: trailingOffender };
    }

    // 9. Forbidden top-level dotfolder. Intrinsic denylist that fires
    // BEFORE the allowlist check, so a caller with a misconfigured
    // `allowedRoots = [".obsidian/plugins/x/"]` cannot pass a candidate
    // under `.obsidian/...` through. NFC + lowercase mirrors the
    // settings-layer validator at `src/settings/pagelet/index.ts:344`
    // so both layers fail the same inputs (APFS/NTFS case-insensitive
    // dispatch, NFD variants). Backslash inputs are already collapsed
    // to "/" by step 6, so `.git\evil.md` is `segments[0] === ".git"`
    // by the time we reach this check.
    const firstSegmentFolded = (segments[0] ?? "").normalize("NFC").toLowerCase();
    if (FORBIDDEN_DOTFOLDER_SEGMENTS.has(firstSegmentFolded)) {
        return { ok: false, reason: "forbidden_dotfolder", detail: segments[0] };
    }

    // 10. Length cap.
    const maxLength = config.maxPathLength ?? DEFAULT_MAX_PATH_LENGTH;
    if (normalized.length > maxLength) {
        return { ok: false, reason: "path_too_long", detail: `${normalized.length} > ${maxLength}` };
    }

    // 11. Allowlist: normalizedPath must start with one of the allowed roots.
    if (!config.allowedRoots || config.allowedRoots.length === 0) {
        return { ok: false, reason: "outside_allowlist", detail: "no allowedRoots configured" };
    }
    const insideAllowlist = config.allowedRoots.some((root) => {
        // Normalize root the same way the candidate was normalized in step 6
        // (backslash → "/", strip leading "./", collapse "//+") so a root
        // stored with Windows separators (e.g. `.pagelet\`) still matches the
        // POSIX-normalized candidate `.pagelet/notes/foo.md`. Issue #363.
        const nr = root
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/\/+/g, "/");
        const rootWithSlash = nr.endsWith("/") ? nr : `${nr}/`;
        return normalized === nr || normalized.startsWith(rootWithSlash);
    });
    if (!insideAllowlist) {
        return { ok: false, reason: "outside_allowlist" };
    }

    // 12. Extension.
    const lastDot = normalized.lastIndexOf(".");
    const lastSlash = normalized.lastIndexOf("/");
    const ext = lastDot > lastSlash ? normalized.substring(lastDot) : "";
    if (!config.allowedExtensions || config.allowedExtensions.length === 0) {
        return { ok: false, reason: "bad_extension", detail: "no allowedExtensions configured" };
    }
    if (!config.allowedExtensions.includes(ext)) {
        return { ok: false, reason: "bad_extension", detail: `got "${ext}"` };
    }

    // 13. Custom reject patterns (caller extensibility; runs after built-in checks).
    if (config.rejectPatterns) {
        for (const pattern of config.rejectPatterns) {
            if (pattern.test(normalized) || pattern.test(candidate)) {
                return {
                    ok: false,
                    reason: "custom_pattern_rejected",
                    detail: `matched ${pattern.toString()}`,
                };
            }
        }
    }

    return { ok: true, normalizedPath: normalized };
}

/**
 * Async validation wrapper. Runs the sync checks first; if those pass and
 * a `fs` probe is supplied, additionally checks:
 *   - folder existence (parent of normalizedPath)
 *   - target collision (normalizedPath itself; v1 create-file refuses overwrite)
 *
 * When `fs` is omitted (e.g., pure unit tests), behaves identically to the
 * sync variant.
 */
export async function validateTargetConfinement(
    candidate: string,
    config: ConfinementConfig,
    fs?: ConfinementFsProbe,
): Promise<ConfinementResult> {
    const syncResult = validateTargetConfinementSync(candidate, config);
    if (!syncResult.ok || !fs) {
        return syncResult;
    }
    const normalized = syncResult.normalizedPath;
    const lastSlash = normalized.lastIndexOf("/");
    const folder = lastSlash > 0 ? normalized.substring(0, lastSlash) : "";

    // Probe folder first so a missing parent is reported distinctly from collision.
    if (folder !== "") {
        const folderExists = await fs.exists(folder);
        if (!folderExists) {
            return { ok: false, reason: "folder_missing", detail: folder };
        }
    }

    const targetExists = await fs.exists(normalized);
    if (targetExists) {
        return { ok: false, reason: "name_collision", detail: normalized };
    }
    return syncResult;
}

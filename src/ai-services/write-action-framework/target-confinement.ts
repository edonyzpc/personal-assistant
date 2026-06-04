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
 * candidate-side denylist in {@link validateTargetConfinementSync} step 6:
 * both sides reject the same input set so the framework remains a true
 * second line of defense regardless of caller wiring.
 */
export function validateAllowedRoots(allowedRoots: readonly string[]): void {
    for (const root of allowedRoots) {
        if (typeof root !== "string" || root.length === 0) continue;
        const normalized = root.replace(/\\/g, "/").replace(/^\.\//, "");
        const firstSegment = normalized.split("/")[0] ?? "";
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
 * Order: empty → control_char → absolute → drive_letter → normalize →
 *        parent_traversal → forbidden_dotfolder → length → allowlist →
 *        extension → custom rejectPatterns.
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

    // 1. Control characters (NUL through 0x1F). Detect on raw input before any
    // normalization to catch payloads that try to smuggle bytes past trim/replace.
    if (/[\x00-\x1f]/.test(candidate)) {
        return { ok: false, reason: "control_char" };
    }

    // 2. Absolute path (POSIX-style leading "/").
    if (candidate.startsWith("/")) {
        return { ok: false, reason: "absolute_path" };
    }

    // 3. Windows drive letter (e.g., "C:/...", "c:\..."). Catch before normalize.
    if (/^[a-zA-Z]:/.test(candidate)) {
        return { ok: false, reason: "drive_letter" };
    }

    // 4. Normalize: convert backslashes to forward slashes (Obsidian uses POSIX
    // separators), strip leading "./", collapse repeated "//".
    let normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
    // Strip a trailing slash so extension check has a real filename to inspect.
    if (normalized.endsWith("/") && normalized.length > 1) {
        normalized = normalized.slice(0, -1);
    }

    // 5. Parent traversal: any segment equal to ".." (covers "../x", "a/../b", "a/..").
    const segments = normalized.split("/");
    if (segments.some((segment) => segment === "..")) {
        return { ok: false, reason: "parent_traversal" };
    }

    // 6. Forbidden top-level dotfolder. Intrinsic denylist that fires
    // BEFORE the allowlist check, so a caller with a misconfigured
    // `allowedRoots = [".obsidian/plugins/x/"]` cannot pass a candidate
    // under `.obsidian/...` through. NFC + lowercase mirrors the
    // settings-layer validator at `src/settings/pagelet/index.ts:344`
    // so both layers fail the same inputs (APFS/NTFS case-insensitive
    // dispatch, NFD variants). Backslash inputs are already collapsed
    // to "/" by step 4, so `.git\evil.md` is `segments[0] === ".git"`
    // by the time we reach this check.
    const firstSegmentFolded = (segments[0] ?? "").normalize("NFC").toLowerCase();
    if (FORBIDDEN_DOTFOLDER_SEGMENTS.has(firstSegmentFolded)) {
        return { ok: false, reason: "forbidden_dotfolder", detail: segments[0] };
    }

    // 7. Length cap.
    const maxLength = config.maxPathLength ?? DEFAULT_MAX_PATH_LENGTH;
    if (normalized.length > maxLength) {
        return { ok: false, reason: "path_too_long", detail: `${normalized.length} > ${maxLength}` };
    }

    // 8. Allowlist: normalizedPath must start with one of the allowed roots.
    if (!config.allowedRoots || config.allowedRoots.length === 0) {
        return { ok: false, reason: "outside_allowlist", detail: "no allowedRoots configured" };
    }
    const insideAllowlist = config.allowedRoots.some((root) => {
        const rootWithSlash = root.endsWith("/") ? root : `${root}/`;
        return normalized === root || normalized.startsWith(rootWithSlash);
    });
    if (!insideAllowlist) {
        return { ok: false, reason: "outside_allowlist" };
    }

    // 9. Extension.
    const lastDot = normalized.lastIndexOf(".");
    const lastSlash = normalized.lastIndexOf("/");
    const ext = lastDot > lastSlash ? normalized.substring(lastDot) : "";
    if (!config.allowedExtensions || config.allowedExtensions.length === 0) {
        return { ok: false, reason: "bad_extension", detail: "no allowedExtensions configured" };
    }
    if (!config.allowedExtensions.includes(ext)) {
        return { ok: false, reason: "bad_extension", detail: `got "${ext}"` };
    }

    // 10. Custom reject patterns (caller extensibility; runs after built-in checks).
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

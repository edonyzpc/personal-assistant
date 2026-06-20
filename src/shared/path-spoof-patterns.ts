/**
 * Shared path-spoof-pattern constants used by BOTH the framework
 * target-confinement layer (`src/ai-services/write-action-framework/target-confinement.ts`)
 * and the settings-layer validator (`src/settings/pagelet/index.ts`).
 *
 * Single-source-of-truth so the two layers cannot drift. Any change here
 * must be validated against both layers' test suites.
 *
 * NFKC lock-step note: the current fold function uses NFC + lowercase.
 * If Obsidian / APFS / NTFS ever folds fullwidth characters to ASCII,
 * upgrade this module to NFKC and bump both consuming layers in the
 * same commit.
 */

import { LEGACY_CONFIG_DIR } from "../obsidian-paths";

export const LEGACY_CONFIG_BACKUP_DIR = `${LEGACY_CONFIG_DIR}.bak`;

/**
 * Top-level path segments that must never be written into. The superset
 * of both layers includes the legacy default Obsidian config dir, common
 * VCS/trash folders, and the conventional backup name for the legacy dir.
 *
 * Membership test is performed after {@link foldForDotfolderCheck} so
 * APFS / NTFS case-insensitive dispatch
 * and NFD variants do not bypass the guard.
 */
export const FORBIDDEN_DOTFOLDER_SEGMENTS: ReadonlySet<string> = new Set([
    LEGACY_CONFIG_DIR,
    ".git",
    ".trash",
    LEGACY_CONFIG_BACKUP_DIR,
]);

/**
 * Cf-category invisible characters used for identifier spoofing — ZWSP/ZWNJ/ZWJ
 * (U+200B–U+200D), WJ (U+2060), BOM/ZWNBSP (U+FEFF), LRM/RLM (U+200E/U+200F),
 * bidi-formats (U+202A–U+202E), bidi-isolates (U+2066–U+2069).
 *
 * Rejects e.g. a path with a leading ZWSP before a config-dir segment
 * that visually reads like the protected directory but bypasses a
 * literal segment-equality check.
 */
export const INVISIBLE_CHARS_RE =
    /[\u200b-\u200d\u2060\ufeff\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * Trailing dot or whitespace per segment. NTFS silently strips trailing
 * `.` / space at the OS layer, so a config-dir segment with a trailing
 * dot or space can dispatch to the real config directory despite a
 * literal segment guard seeing a different string. Same class of bypass
 * for trailing tab/NBSP via `\s`.
 */
export const TRAILING_DOT_OR_SPACE_RE = /[.\s]$/;

/**
 * NFC + lowercase fold for dotfolder segment comparison. Both the
 * framework and settings layers must use the same fold so APFS / NTFS
 * case-insensitive dispatch and NFD variants are handled identically.
 *
 * If Obsidian / APFS / NTFS ever folds fullwidth characters to ASCII,
 * upgrade to NFKC in this function AND both consuming layers in
 * lock-step (see SDD §2.2 note).
 */
export function foldForDotfolderCheck(segment: string): string {
    return segment.normalize("NFC").toLowerCase();
}

import { describe, expect, it, jest } from "@jest/globals";

import {
    ConfinementConfigError,
    DEFAULT_MAX_PATH_LENGTH,
    validateAllowedRoots,
    validateTargetConfinement,
    validateTargetConfinementSync,
    type ConfinementFsProbe,
} from "./target-confinement";
import type { ConfinementConfig } from "./types";

const baseConfig: ConfinementConfig = {
    allowedRoots: [".pagelet/"],
    allowedExtensions: [".md"],
    maxPathLength: 200,
};

describe("validateTargetConfinementSync (framework SDD §2.2)", () => {
    it("accepts a clean vault-relative .md inside .pagelet/", () => {
        const result = validateTargetConfinementSync(".pagelet/2026-06-02-meeting.md", baseConfig);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/2026-06-02-meeting.md" });
    });

    it("rejects empty_path for empty string", () => {
        expect(validateTargetConfinementSync("", baseConfig)).toMatchObject({
            ok: false,
            reason: "empty_path",
        });
    });

    it("rejects empty_path for whitespace-only string", () => {
        expect(validateTargetConfinementSync("   ", baseConfig)).toMatchObject({
            ok: false,
            reason: "empty_path",
        });
    });

    it("rejects control_char when path contains NUL/0x01", () => {
        const withNul = ".pagelet/foo\x00bar.md";
        expect(validateTargetConfinementSync(withNul, baseConfig)).toMatchObject({
            ok: false,
            reason: "control_char",
        });
    });

    it("rejects absolute_path for leading slash", () => {
        expect(validateTargetConfinementSync("/etc/passwd", baseConfig)).toMatchObject({
            ok: false,
            reason: "absolute_path",
        });
    });

    it("rejects drive_letter for Windows-style C:/...", () => {
        expect(validateTargetConfinementSync("C:/Users/x.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "drive_letter",
        });
        // lowercase drive too
        expect(validateTargetConfinementSync("c:\\foo.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "drive_letter",
        });
    });

    it("rejects parent_traversal for embedded .. segment", () => {
        expect(validateTargetConfinementSync(".pagelet/../config.json", baseConfig)).toMatchObject({
            ok: false,
            reason: "parent_traversal",
        });
        expect(validateTargetConfinementSync("../escape.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "parent_traversal",
        });
    });

    // forbidden_dotfolder denylist — defense-in-depth that fires BEFORE the
    // allowlist check, so a caller with a misconfigured `allowedRoots`
    // pointing into a forbidden segment still fails closed. NFC + case-fold
    // mirrors `src/settings/pagelet/index.ts:344`.
    it("rejects forbidden_dotfolder for top-level .obsidian segment", () => {
        // The misconfigured-allowlist case: even when `allowedRoots` is
        // (wrongly) `.obsidian/...`, the candidate is still rejected.
        const cfg: ConfinementConfig = {
            allowedRoots: [".obsidian/plugins/x/"],
            allowedExtensions: [".md"],
        };
        const result = validateTargetConfinementSync(".obsidian/plugins/x/evil.md", cfg);
        expect(result).toMatchObject({ ok: false, reason: "forbidden_dotfolder", detail: ".obsidian" });
    });

    it("rejects forbidden_dotfolder for top-level .git segment", () => {
        expect(validateTargetConfinementSync(".git/config.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "forbidden_dotfolder",
            detail: ".git",
        });
    });

    it("rejects forbidden_dotfolder for top-level .trash segment", () => {
        expect(validateTargetConfinementSync(".trash/note.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "forbidden_dotfolder",
            detail: ".trash",
        });
    });

    it("rejects forbidden_dotfolder for top-level .obsidian.bak segment", () => {
        expect(validateTargetConfinementSync(".obsidian.bak/snapshot.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "forbidden_dotfolder",
            detail: ".obsidian.bak",
        });
    });

    it("rejects forbidden_dotfolder for case-fold variants (.Obsidian / .OBSIDIAN.BAK)", () => {
        // APFS / NTFS dispatch case-insensitively, so the OS would still
        // route the write into the real `.obsidian/`. NFC + lowercase fold
        // must catch this before the allowlist gets a chance to.
        expect(validateTargetConfinementSync(".Obsidian/plugins/x/foo.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "forbidden_dotfolder",
            detail: ".Obsidian",
        });
        expect(validateTargetConfinementSync(".OBSIDIAN.BAK/snapshot.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "forbidden_dotfolder",
            detail: ".OBSIDIAN.BAK",
        });
    });

    it("rejects forbidden_dotfolder for backslash inputs (.git\\foo.md)", () => {
        // Backslash → forward slash collapse happens in step 4, so by the
        // time the segment guard runs, `.git\\foo.md` is `[".git", "foo.md"]`.
        expect(validateTargetConfinementSync(".git\\foo.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "forbidden_dotfolder",
            detail: ".git",
        });
    });

    it("does NOT reject forbidden_dotfolder when the forbidden name appears nested-deep", () => {
        // Only the TOP-LEVEL segment is denied; a nested folder literally
        // named `.git-archive` or `notes/.obsidian-cheatsheet` is harmless
        // and should fall through to the regular allowlist check.
        const cfg: ConfinementConfig = {
            allowedRoots: ["notes/"],
            allowedExtensions: [".md"],
        };
        const result = validateTargetConfinementSync("notes/.obsidian-cheatsheet/tips.md", cfg);
        expect(result).toEqual({ ok: true, normalizedPath: "notes/.obsidian-cheatsheet/tips.md" });
    });

    // invisible_chars — Cf-category spoof defense (issue #360). Mirror of
    // settings-layer `src/settings/pagelet/index.ts:287`. Fires on RAW input
    // BEFORE normalize so a ZWSP-prefixed `.obsidian` does not slip past the
    // dotfolder denylist by being a different literal string.
    it("rejects invisible_chars for ZWSP prefix on .obsidian (the canonical spoof)", () => {
        // The whole point of this defense: must report `invisible_chars`,
        // NOT `forbidden_dotfolder`, because the segment is `.obsidian`
        // (with the zero-width prefix) and the fold check would never match
        // `.obsidian`. The check order in the validator is what catches this.
        const result = validateTargetConfinementSync("​.obsidian/plugins/x.md", baseConfig);
        expect(result).toMatchObject({ ok: false, reason: "invisible_chars" });
    });

    it("rejects invisible_chars for ZWNJ / ZWJ / WJ / BOM variants", () => {
        for (const ch of ["‌", "‍", "⁠", "﻿"]) {
            const path = `.pagelet/no${ch}te.md`;
            expect(validateTargetConfinementSync(path, baseConfig)).toMatchObject({
                ok: false,
                reason: "invisible_chars",
            });
        }
    });

    it("rejects invisible_chars for LRM / RLM directional marks", () => {
        for (const ch of ["‎", "‏"]) {
            const path = `.pagelet/n${ch}ote.md`;
            expect(validateTargetConfinementSync(path, baseConfig)).toMatchObject({
                ok: false,
                reason: "invisible_chars",
            });
        }
    });

    it("rejects invisible_chars for bidi-isolate marks (U+2066–U+2069)", () => {
        const path = `.pagelet/⁦hidden.md⁩`;
        expect(validateTargetConfinementSync(path, baseConfig)).toMatchObject({
            ok: false,
            reason: "invisible_chars",
        });
    });

    // trailing_dot_or_space — NTFS-bypass defense (issue #360). Mirror of
    // settings-layer `src/settings/pagelet/index.ts:330`. MUST fire BEFORE
    // forbidden_dotfolder so `.obsidian./...` reports the actual spoof class.
    it("rejects trailing_dot_or_space for .obsidian./plugins (the canonical NTFS spoof)", () => {
        // Critical-order test: `.obsidian.` would not match the fold so it
        // would slip past forbidden_dotfolder — but NTFS would still route
        // the write to the real `.obsidian/`. Must report
        // `trailing_dot_or_space`, NOT `forbidden_dotfolder`.
        const result = validateTargetConfinementSync(".obsidian./plugins/x.md", baseConfig);
        expect(result).toMatchObject({
            ok: false,
            reason: "trailing_dot_or_space",
            detail: ".obsidian.",
        });
    });

    it("rejects trailing_dot_or_space for trailing dot on a nested segment", () => {
        expect(validateTargetConfinementSync(".pagelet/sub./file.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "trailing_dot_or_space",
            detail: "sub.",
        });
    });

    it("rejects trailing_dot_or_space for trailing space on a nested segment", () => {
        expect(validateTargetConfinementSync(".pagelet/sub /file.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "trailing_dot_or_space",
            detail: "sub ",
        });
    });

    it("rejects trailing_dot_or_space for trailing NBSP (\\s covers U+00A0)", () => {
        // Tab/CR/LF would be eaten by the earlier `control_char` step (they're
        // in [\x00-\x1f]); NBSP isn't a control char but `\s` matches it, so
        // it's the right witness for "trailing whitespace beyond ASCII space".
        expect(validateTargetConfinementSync(".pagelet/sub /file.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "trailing_dot_or_space",
            detail: "sub ",
        });
    });

    it("does NOT trip trailing_dot_or_space when a segment ends in a normal char", () => {
        // Sanity: only literal trailing `.` or `\s` matches; a normal filename
        // like `foo.md` ends in `d`, not `.` or whitespace.
        const result = validateTargetConfinementSync(".pagelet/notes/foo.md", baseConfig);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/notes/foo.md" });
    });

    it("rejects path_too_long when normalized path exceeds maxPathLength", () => {
        const longName = "a".repeat(300);
        const result = validateTargetConfinementSync(`.pagelet/${longName}.md`, baseConfig);
        expect(result).toMatchObject({ ok: false, reason: "path_too_long" });
    });

    it("uses DEFAULT_MAX_PATH_LENGTH when maxPathLength omitted", () => {
        const cfg: ConfinementConfig = { allowedRoots: [".pagelet/"], allowedExtensions: [".md"] };
        const longName = "a".repeat(DEFAULT_MAX_PATH_LENGTH);
        const result = validateTargetConfinementSync(`.pagelet/${longName}.md`, cfg);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("path_too_long");
    });

    it("rejects outside_allowlist for paths outside allowedRoots", () => {
        expect(validateTargetConfinementSync("other-folder/foo.md", baseConfig)).toMatchObject({
            ok: false,
            reason: "outside_allowlist",
        });
    });

    it("rejects outside_allowlist when allowedRoots is empty", () => {
        const cfg: ConfinementConfig = { allowedRoots: [], allowedExtensions: [".md"] };
        expect(validateTargetConfinementSync(".pagelet/foo.md", cfg)).toMatchObject({
            ok: false,
            reason: "outside_allowlist",
        });
    });

    it("rejects bad_extension for wrong extension", () => {
        expect(validateTargetConfinementSync(".pagelet/foo.txt", baseConfig)).toMatchObject({
            ok: false,
            reason: "bad_extension",
        });
    });

    it("rejects bad_extension when allowedExtensions is empty", () => {
        const cfg: ConfinementConfig = { allowedRoots: [".pagelet/"], allowedExtensions: [] };
        expect(validateTargetConfinementSync(".pagelet/foo.md", cfg)).toMatchObject({
            ok: false,
            reason: "bad_extension",
        });
    });

    it("rejects custom_pattern_rejected when a caller-supplied rejectPattern matches", () => {
        const cfg: ConfinementConfig = {
            ...baseConfig,
            rejectPatterns: [/secret/i],
        };
        expect(validateTargetConfinementSync(".pagelet/my-secret.md", cfg)).toMatchObject({
            ok: false,
            reason: "custom_pattern_rejected",
        });
    });

    it("normalizes leading './' and collapses duplicate slashes", () => {
        const result = validateTargetConfinementSync("./.pagelet//deep///file.md", baseConfig);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/deep/file.md" });
    });

    it("normalizes backslashes to forward slashes (still validated against allowlist)", () => {
        const result = validateTargetConfinementSync(".pagelet\\nested\\file.md", baseConfig);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/nested/file.md" });
    });

    it("accepts a multi-root allowlist", () => {
        const cfg: ConfinementConfig = {
            allowedRoots: [".pagelet/", ".pagelet-reviews/"],
            allowedExtensions: [".md"],
        };
        expect(validateTargetConfinementSync(".pagelet-reviews/note.md", cfg)).toEqual({
            ok: true,
            normalizedPath: ".pagelet-reviews/note.md",
        });
    });

    // Issue #363: Windows backslash in allowlist roots — the allowlist match
    // must normalize roots the same way the candidate is normalized so a root
    // stored as `.pagelet\` matches the POSIX-normalized candidate.
    it("accepts backslash candidate against backslash root (.pagelet\\notes\\foo.md vs .pagelet\\)", () => {
        const cfg: ConfinementConfig = {
            allowedRoots: [".pagelet\\"],
            allowedExtensions: [".md"],
        };
        const result = validateTargetConfinementSync(".pagelet\\notes\\foo.md", cfg);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/notes/foo.md" });
    });

    it("accepts forward-slash candidate against backslash root (.pagelet/notes/foo.md vs .pagelet\\)", () => {
        const cfg: ConfinementConfig = {
            allowedRoots: [".pagelet\\"],
            allowedExtensions: [".md"],
        };
        const result = validateTargetConfinementSync(".pagelet/notes/foo.md", cfg);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/notes/foo.md" });
    });

    // Issue #365 review: pin that ./-prefixed roots work after step 11
    // strips the leading `./` via `.replace(/^\.\//, "")`.
    it("accepts candidate against ./-prefixed root (./.pagelet/)", () => {
        const cfg: ConfinementConfig = {
            allowedRoots: ["./.pagelet/"],
            allowedExtensions: [".md"],
        };
        const result = validateTargetConfinementSync(".pagelet/notes/foo.md", cfg);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/notes/foo.md" });
    });
});

describe("validateTargetConfinement (async with FS probe)", () => {
    function probe(map: Record<string, boolean>): ConfinementFsProbe {
        return {
            exists: jest.fn(async (path: string) => map[path] ?? false) as ConfinementFsProbe["exists"],
        };
    }

    it("returns sync result when no FS probe supplied", async () => {
        const result = await validateTargetConfinement(".pagelet/foo.md", baseConfig);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/foo.md" });
    });

    it("rejects folder_missing when parent folder absent", async () => {
        const fs = probe({});
        const result = await validateTargetConfinement(".pagelet/sub/foo.md", baseConfig, fs);
        expect(result).toMatchObject({ ok: false, reason: "folder_missing", detail: ".pagelet/sub" });
    });

    it("rejects name_collision when target already exists", async () => {
        const fs = probe({ ".pagelet": true, ".pagelet/foo.md": true });
        const result = await validateTargetConfinement(".pagelet/foo.md", baseConfig, fs);
        expect(result).toMatchObject({ ok: false, reason: "name_collision", detail: ".pagelet/foo.md" });
    });

    it("returns ok when folder exists and target does not collide", async () => {
        const fs = probe({ ".pagelet": true });
        const result = await validateTargetConfinement(".pagelet/foo.md", baseConfig, fs);
        expect(result).toEqual({ ok: true, normalizedPath: ".pagelet/foo.md" });
    });

    it("skips folder probe when path is at vault root (no slash)", async () => {
        // edge: a path with no slash means folder=""; probe should not be called for folder
        const cfg: ConfinementConfig = { allowedRoots: ["./"], allowedExtensions: [".md"] };
        const fs = probe({});
        // candidate has root "./" → normalized "foo.md" → folder=""
        const result = await validateTargetConfinement("./foo.md", cfg, fs);
        // bypass folder check; collision probe runs (returns false → ok)
        // outside_allowlist may apply since "foo.md" doesn't start with "./" once normalized
        // — so this should reject as outside_allowlist (the test ensures we hit that branch
        // rather than the folder branch).
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("outside_allowlist");
    });

    it("short-circuits FS probe when sync validation fails", async () => {
        const fs = probe({});
        const result = await validateTargetConfinement("/etc/passwd", baseConfig, fs);
        expect(result).toMatchObject({ ok: false, reason: "absolute_path" });
        expect((fs.exists as jest.Mock)).not.toHaveBeenCalled();
    });
});

describe("validateAllowedRoots (framework SDD §2.2 / issue #358 AC #1)", () => {
    it("does nothing when allowedRoots is empty", () => {
        expect(() => validateAllowedRoots([])).not.toThrow();
    });

    it("accepts ordinary roots like .pagelet/, notes/, sub/path/", () => {
        expect(() => validateAllowedRoots([".pagelet/", "notes/", "sub/path/"])).not.toThrow();
    });

    it("throws ConfinementConfigError for .obsidian/ root", () => {
        expect(() => validateAllowedRoots([".obsidian/plugins/x/"])).toThrow(ConfinementConfigError);
        try {
            validateAllowedRoots([".obsidian/plugins/x/"]);
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("forbidden_dotfolder");
            expect(e.offendingRoot).toBe(".obsidian/plugins/x/");
            expect(e.offendingSegment).toBe(".obsidian");
        }
    });

    it("throws for .git/, .trash/, .obsidian.bak/", () => {
        expect(() => validateAllowedRoots([".git/"])).toThrow(ConfinementConfigError);
        expect(() => validateAllowedRoots([".trash/"])).toThrow(ConfinementConfigError);
        expect(() => validateAllowedRoots([".obsidian.bak/"])).toThrow(ConfinementConfigError);
    });

    it("throws for case-fold variants (.Obsidian/, .OBSIDIAN.BAK/)", () => {
        expect(() => validateAllowedRoots([".Obsidian/"])).toThrow(ConfinementConfigError);
        expect(() => validateAllowedRoots([".OBSIDIAN.BAK/"])).toThrow(ConfinementConfigError);
    });

    it("throws for backslash inputs (.git\\plugins\\)", () => {
        expect(() => validateAllowedRoots([".git\\plugins\\"])).toThrow(ConfinementConfigError);
    });

    it("throws for leading ./ form (./.obsidian/plugins/)", () => {
        expect(() => validateAllowedRoots(["./.obsidian/plugins/"])).toThrow(ConfinementConfigError);
    });

    it("does NOT throw when the forbidden name appears nested-deep", () => {
        // Mirror of validateTargetConfinementSync: only segments[0] is checked.
        expect(() => validateAllowedRoots(["notes/.obsidian-cheatsheet/"])).not.toThrow();
        expect(() => validateAllowedRoots(["sub/.git-archive/"])).not.toThrow();
    });

    it("throws on the first offending root in a mixed array (fail-fast)", () => {
        expect(() => validateAllowedRoots([".pagelet/", ".obsidian/x/", "notes/"])).toThrow(
            ConfinementConfigError,
        );
    });

    it("error message names both root and segment for triage", () => {
        try {
            validateAllowedRoots([".obsidian/plugins/x/"]);
            throw new Error("should have thrown");
        } catch (err) {
            expect((err as Error).message).toContain(".obsidian/plugins/x/");
            expect((err as Error).message).toContain(".obsidian");
            expect((err as Error).message).toContain("forbidden_dotfolder");
        }
    });

    // Issue #360 round-1 review collateral: register-side now mirrors the
    // sync-side control_char / absolute_path / drive_letter checks so the
    // "defense-in-depth second line" promise is true parity rather than the
    // narrower invisible_chars + trailing_dot_or_space mirror originally
    // scoped for #360.
    it("throws control_char when an allowed root contains a NUL byte", () => {
        const root = ".pagelet\x00/";
        try {
            validateAllowedRoots([root]);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("control_char");
            expect(e.offendingRoot).toBe(root);
        }
    });

    it("throws absolute_path when an allowed root starts with /", () => {
        try {
            validateAllowedRoots(["/etc/pagelet/"]);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("absolute_path");
            expect(e.offendingRoot).toBe("/etc/pagelet/");
        }
    });

    it("throws drive_letter when an allowed root is Windows-rooted (C:/...)", () => {
        try {
            validateAllowedRoots(["C:/Users/x/"]);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("drive_letter");
            expect(e.offendingRoot).toBe("C:/Users/x/");
        }
    });

    // Issue #360 collateral: register-side now mirrors the sync-side
    // parent_traversal check too (was missing in #358's minimal scope —
    // surfaced by the prompt-injection fixture for `../../config.json`).
    it("throws parent_traversal when an allowed root contains a `..` segment", () => {
        try {
            validateAllowedRoots(["../../config.json/"]);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("parent_traversal");
            expect(e.offendingSegment).toBe("..");
        }
    });

    // Issue #360: register-time mirrors of the two new sync-side reasons.
    it("throws invisible_chars for a root containing a ZWSP", () => {
        const root = "​.pagelet/";
        try {
            validateAllowedRoots([root]);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("invisible_chars");
            expect(e.offendingRoot).toBe(root);
        }
    });

    it("throws trailing_dot_or_space when a top-level root segment ends in space", () => {
        try {
            validateAllowedRoots([".pagelet /"]);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("trailing_dot_or_space");
            expect(e.offendingSegment).toBe(".pagelet ");
        }
    });

    it("throws trailing_dot_or_space when a NESTED root segment ends in dot", () => {
        try {
            validateAllowedRoots([".pagelet/sub./"]);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ConfinementConfigError);
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("trailing_dot_or_space");
            expect(e.offendingSegment).toBe("sub.");
        }
    });

    it("throws trailing_dot_or_space (NOT forbidden_dotfolder) for .obsidian./plugins/", () => {
        // Order assertion: the same critical-order property as the sync side.
        // `.obsidian.` would not match the dotfolder fold; the trailing check
        // must run first or the spoof slips through.
        try {
            validateAllowedRoots([".obsidian./plugins/"]);
            throw new Error("should have thrown");
        } catch (err) {
            const e = err as ConfinementConfigError;
            expect(e.reason).toBe("trailing_dot_or_space");
            expect(e.offendingRoot).toBe(".obsidian./plugins/");
            expect(e.offendingSegment).toBe(".obsidian.");
        }
    });

    it("does NOT trip trailing_dot_or_space on the empty terminal segment of `.pagelet/`", () => {
        // Defensive check: roots conventionally end in `/`, splitting to
        // [".pagelet", ""]. The empty terminal must be skipped so legitimate
        // roots aren't rejected.
        expect(() => validateAllowedRoots([".pagelet/"])).not.toThrow();
    });
});

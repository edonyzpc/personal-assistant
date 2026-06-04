import { describe, expect, it, jest } from "@jest/globals";

import {
    DEFAULT_MAX_PATH_LENGTH,
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

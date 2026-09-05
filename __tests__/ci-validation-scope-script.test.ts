import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const classifier = join(process.cwd(), "scripts/ci-validation-scope.mjs");
const temporaryRepos: string[] = [];
const tracker = join("docs", "development", "active", "example", "tracker.md");

afterEach(() => {
    for (const repo of temporaryRepos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

describe("CI documentation scope", () => {
    it("routes ordinary Markdown edits, additions and deletions to docs", () => {
        const oldArchive = join("docs", "archive", "old.md");
        const { repo, base } = fixture({ [tracker]: "before", [oldArchive]: "old" });
        write(repo, tracker, "after");
        write(repo, join("docs", "product", "specs", "example.md"), "new spec");
        write(repo, join("docs", "architecture", "example.md"), "new architecture");
        write(repo, "docs/backlog.md", "new backlog");
        write(repo, "docs/index.md", "new index");
        write(repo, "docs/development-roadmap.md", "new roadmap");
        rmSync(join(repo, oldArchive));
        commit(repo);

        expect(classify(repo, base)).toBe("docs");
    });

    it.each([
        "README.md", "README-CN.md", "CHANGELOG.md", "LICENSE", "NOTICE",
        "THIRD_PARTY_NOTICES.md", "TRADEMARKS.md", "docs/operations/release-process.md",
        join("docs", "guides", "usage.md"), "skills/sample/SKILL.md", ".agents/skills/sample/SKILL.md",
        "src/main.ts", "scripts/task.mjs", ".github/workflows/ci.yml", "package.json",
        "docs/development/fixture.json", join("docs", "unknown", "example.md"),
    ])("keeps mixed changes containing %s on the full path", (file) => {
        const { repo, base } = fixture({ [tracker]: "before" });
        write(repo, tracker, "after");
        write(repo, file, "changed");
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it.each([
        ["skills/sample/SKILL.md", tracker],
        [tracker, "docs/operations/release-process.md"],
    ])("checks both sides of a rename from %s to %s", (source, destination) => {
        const { repo, base } = fixture({ [source]: "unchanged document" });
        mkdirSync(dirname(join(repo, destination)), { recursive: true });
        renameSync(join(repo, source), join(repo, destination));
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it("keeps deletions of protected documents on the full path", () => {
        const { repo, base } = fixture({ "NOTICE": "legal", [tracker]: "tracker" });
        rmSync(join(repo, "NOTICE"));
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it("compares every commit since the event base rather than only HEAD^", () => {
        const { repo, base } = fixture({ [tracker]: "before" });
        write(repo, "src/main.ts", "runtime change");
        commit(repo);
        write(repo, tracker, "after");
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it("compares the checked-out PR merge result against the current PR base", () => {
        const { repo } = fixture({ [tracker]: "before" });
        git(repo, ["checkout", "-b", "feature"]);
        write(repo, tracker, "feature documentation");
        commit(repo);
        git(repo, ["checkout", "main"]);
        write(repo, "src/main.ts", "base branch runtime change");
        const base = commit(repo);
        git(repo, ["merge", "--no-ff", "--no-edit", "feature"]);

        expect(classify(repo, base)).toBe("docs");
    });

    it.each([undefined, "", "0".repeat(40), "f".repeat(40), "HEAD", "--help", "bad\nSHA"])(
        "falls back to full for an absent, invalid or unavailable base (%s)", (base) => {
            const { repo } = fixture({ [tracker]: "before" });
            write(repo, tracker, "after");
            commit(repo);

            expect(classify(repo, base)).toBe("full");
        },
    );

    it("does not interpret a shell expression supplied as the base", () => {
        const { repo } = fixture({ [tracker]: "before" });
        expect(classify(repo, "$(touch scope-injection)")).toBe("full");
        expect(existsSync(join(repo, "scope-injection"))).toBe(false);
    });

    it("falls back to full for an empty diff or a non-commit object", () => {
        const { repo, base } = fixture({ [tracker]: "before" });
        expect(classify(repo, base)).toBe("full");
        expect(classify(repo, git(repo, ["rev-parse", "HEAD^{tree}"]))).toBe("full");
    });
});

function fixture(files: Record<string, string>): { repo: string; base: string } {
    const repo = mkdtempSync(join(tmpdir(), "pa-ci-scope-"));
    temporaryRepos.push(repo);
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.name", "Test User"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.hooksPath", "/dev/null"]);
    for (const [file, content] of Object.entries(files)) write(repo, file, content);
    return { repo, base: commit(repo) };
}

function write(repo: string, file: string, content: string): void {
    const target = join(repo, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
}

function git(repo: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
}

function commit(repo: string): string {
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "fixture change"]);
    return git(repo, ["rev-parse", "HEAD"]);
}

function classify(repo: string, base?: string): string {
    const output = join(repo, ".git", "scope-output");
    rmSync(output, { force: true });
    execFileSync(process.execPath, [classifier], {
        cwd: repo,
        env: { ...process.env, CI_VALIDATION_BASE: base, GITHUB_OUTPUT: output },
        stdio: "pipe",
    });
    return readFileSync(output, "utf8").trim().replace("scope=", "");
}

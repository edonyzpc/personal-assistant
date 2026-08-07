import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import {
    appendFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const requiredFiles = [
    "README.md",
    "README-CN.md",
    "CHANGELOG.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "TRADEMARKS.md",
    "docs/operations/release-process.md",
    "docs/operations/brat-beta-testing.md",
];

describe("scripts/check-release-docs.mjs", () => {
    it("accepts the baseline release documentation set", () => {
        expect(runCheck(createFixture())).toContain("Release documentation check passed");
    });

    it("does not inspect malformed Active Package lifecycle metadata", () => {
        const repo = createFixture();
        write(repo, syntheticPath("development", "active", "planning", "tracker.md"), [
            "# Planning tracker",
            "Delivery status: Definitely not a lifecycle status",
            "Authority: missing",
        ].join("\n"));

        expect(runCheck(repo)).toContain("Release documentation check passed");
    });

    it("does not inspect broken links outside required release documents", () => {
        const repo = createFixture();
        write(repo, syntheticPath("development", "active", "planning", "README.md"), "[Missing](./missing.md)\n");

        expect(runCheck(repo)).toContain("Release documentation check passed");
    });

    it.each(["README.md", "NOTICE"])("rejects a missing required file: %s", (file) => {
        const repo = createFixture();
        rmSync(join(repo, file));

        expect(expectCheckFailure(repo)).toContain(`Missing required release file: ${file}`);
    });

    it.each(["README-CN.md", "LICENSE"])("rejects an empty required file: %s", (file) => {
        const repo = createFixture();
        write(repo, file, " \n\t\n");

        expect(expectCheckFailure(repo)).toContain(`Required release file is empty: ${file}`);
    });

    it("rejects broken direct Markdown links in required documents", () => {
        const repo = createFixture();
        append(repo, "README.md", "\n[Missing guide](./docs/missing.md)\n");

        expect(expectCheckFailure(repo)).toContain("README.md -> missing local target: ./docs/missing.md");
    });

    it("rejects broken direct HTML media targets in required documents", () => {
        const repo = createFixture();
        append(repo, "docs/operations/release-process.md", "\n<img src=\"../assets/missing.png\">\n");

        expect(expectCheckFailure(repo)).toContain(
            "docs/operations/release-process.md -> missing local target: ../assets/missing.png",
        );
    });

    it("accepts external, anchor, query and fragment targets", () => {
        const repo = createFixture();
        write(repo, syntheticPath("operations", "details.md"), "# Details\n");
        append(repo, "docs/operations/brat-beta-testing.md", [
            "",
            "[Web](https://example.com/docs)",
            "[Wrapped web](<https://example.com/docs with spaces>)",
            "[Mail](mailto:test@example.com)",
            "[Section](#manual-test)",
            "[Query only](?download=1)",
            "[Local query and fragment](./details.md?mode=beta#steps)",
            "<a href=\"#html-anchor\">Anchor</a>",
        ].join("\n"));

        expect(runCheck(repo)).toContain("Release documentation check passed");
    });

    it("rejects a direct target that escapes the repository", () => {
        const repo = createFixture();
        append(repo, "README.md", "\n[Outside](../outside.md)\n");

        expect(expectCheckFailure(repo)).toContain("README.md -> target escapes repository: ../outside.md");
    });

    it("validates unquoted HTML targets", () => {
        const repo = createFixture();
        append(repo, "TRADEMARKS.md", "\n<a href=./missing-trademark-policy.md>Policy</a>\n");

        expect(expectCheckFailure(repo)).toContain(
            "TRADEMARKS.md -> missing local target: ./missing-trademark-policy.md",
        );
    });

    it("ignores links inside fenced and inline code", () => {
        const repo = createFixture();
        append(repo, "README-CN.md", [
            "",
            "`[inline](./missing-inline.md)`",
            "```md",
            "[fenced](./missing-fenced.md)",
            "<img src=\"./missing-fenced.png\">",
            "```",
        ].join("\n"));

        expect(runCheck(repo)).toContain("Release documentation check passed");
    });

    it("does not depend on DOCS_CHECK_BASE", () => {
        expect(runCheck(createFixture(), {
            DOCS_CHECK_BASE: "not-a-real-ref",
        })).toContain("Release documentation check passed");
    });
});

function createFixture(): string {
    const repo = mkdtempSync(join(tmpdir(), "pa-release-docs-"));
    for (const file of requiredFiles) write(repo, file, `# ${file}\n`);
    return repo;
}

function syntheticPath(...parts: string[]): string {
    return ["docs", ...parts].join("/");
}

function write(repo: string, file: string, content: string): void {
    const target = join(repo, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
}

function append(repo: string, file: string, content: string): void {
    appendFileSync(join(repo, file), content, "utf8");
}

function runCheck(repo: string, env: NodeJS.ProcessEnv = {}): string {
    return execFileSync("node", [
        join(process.cwd(), "scripts/check-release-docs.mjs"),
    ], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, ...env },
    });
}

function expectCheckFailure(repo: string): string {
    try {
        runCheck(repo);
    } catch (error) {
        const commandError = error as { message: string; stdout?: string; stderr?: string };
        return [
            commandError.stdout ?? "",
            commandError.stderr ?? "",
            commandError.message,
        ].join("\n");
    }
    throw new Error("Expected release documentation check to fail.");
}

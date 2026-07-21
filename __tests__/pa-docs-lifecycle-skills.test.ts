import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const docsSkill = read(".agents/skills/pa-docs-lifecycle-manager/SKILL.md");
const sddSkill = read(".agents/skills/sdd-lifecycle/SKILL.md");

describe("PA lifecycle skill forward contracts", () => {
    it("keeps explicit read-only requests globally zero-write", () => {
        for (const phrase of ["`review-only`", "`analysis-only`", "`read-only`", "`no-file-changes`", "不要改文件", "**zero writes**"]) {
            expect(docsSkill).toContain(phrase);
        }
        expect(sddSkill).toContain("request means **zero writes**");
    });

    it("keeps casual ideas local and persists only explicit capture or promotion", () => {
        expect(docsSkill).toContain("Casual idea or feedback");
        expect(docsSkill).toContain("create or reuse one minimal Backlog row");
        expect(docsSkill).toContain("Product decision / version candidate / cross-session execution");
    });

    it("keeps the removed project Linear route absent", () => {
        expect(existsSync(join(repoRoot, ".agents/skills/pa-linear-product-manager/SKILL.md"))).toBe(false);
        expect(docsSkill).not.toContain("`pa-linear-product-manager`");
        expect(docsSkill).toContain("Existing external tracker links are provenance only");
    });

    it("uses progressive reads instead of preloading the hierarchy", () => {
        expect(docsSkill).toContain("Read Minimally");
        expect(docsSkill).toContain("read a template only when");
        expect(docsSkill).toContain("Do not preload Roadmap, every index, every contract, templates, or Archive");
    });

    it("uses Tracker-only status and optional Plan/SDD", () => {
        expect(docsSkill).toContain("Tracker is the only delivery-status and execution authority");
        expect(docsSkill).toContain("Active Registry is link-only");
        expect(docsSkill).toContain("starts with `README.md` and `tracker.md`");
        expect(docsSkill).toContain("Add `plan.md` only");
        expect(docsSkill).toContain("Add `sdd.md` only");
        expect(sddSkill).toContain("Baseline Active Package: `README.md` + `tracker.md`");
    });

    it("deletes absorbed process artifacts instead of archiving complete packages", () => {
        expect(docsSkill).toContain("Delete process artifacts after absorption by default");
        expect(normalize(docsSkill)).toContain("Do not archive a complete package merely because it existed");
        expect(normalize(sddSkill)).toContain("do not preserve a complete package by default");
    });

    it("keeps plan-and-implement, closeout, and Git boundaries separate", () => {
        expect(docsSkill).toContain("implement-approved-spec");
        expect(docsSkill).toContain("Only explicit full-lifecycle or closeout language");
        expect(sddSkill).toContain("never implies closeout,\narchive, or commit");
        expect(sddSkill).toContain("Do not stage, commit, push, tag, publish, or release without explicit authority");
    });

    it("keeps product and governance authority lanes separate", () => {
        expect(docsSkill).toContain("Product behavior, runtime, UI, data, privacy, or permissions");
        expect(docsSkill).toContain("Repo documentation, checker, CI/release tooling, or Agent workflow");
        expect(sddSkill).toContain("Use exactly one authority lane");
    });

    it("fails closed on an archive collision", () => {
        expect(docsSkill).toContain("If a chosen archive destination already exists, fail closed");
        expect(sddSkill).toContain("If a selected archive path exists, fail closed");
    });

    it("keeps the router compact enough for routine invocation", () => {
        expect(docsSkill.split("\n").length).toBeLessThanOrEqual(140);
        expect(sddSkill.split("\n").length).toBeLessThanOrEqual(150);
    });

    it("keeps the docs manager implicit and SDD explicitly routed", () => {
        const docsMetadata = read(".agents/skills/pa-docs-lifecycle-manager/agents/openai.yaml");
        const sddMetadata = read(".agents/skills/sdd-lifecycle/agents/openai.yaml");
        expect(docsMetadata).toContain("$pa-docs-lifecycle-manager");
        expect(docsMetadata).toContain("allow_implicit_invocation: true");
        expect(sddMetadata).toContain("$sdd-lifecycle");
        expect(sddMetadata).toContain("allow_implicit_invocation: false");
    });
});

function read(relativePath: string): string {
    return readFileSync(join(repoRoot, relativePath), "utf8");
}

function normalize(content: string): string {
    return content.replace(/\s+/gu, " ").trim();
}

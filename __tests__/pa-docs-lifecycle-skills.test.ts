import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

const docsSkill = read(".agents/skills/pa-docs-lifecycle-manager/SKILL.md");
const sddSkill = read(".agents/skills/sdd-lifecycle/SKILL.md");
const docsContract = normalize(docsSkill);
const sddContract = normalize(sddSkill);

describe("PA lifecycle skill forward contracts", () => {
    it("keeps explicit review-only and no-file-changes requests globally zero-write", () => {
        for (const phrase of [
            "`review-only`",
            "`analysis-only`",
            "`read-only`",
            "`no-file-changes`",
            "不要改文件",
            "zero writes",
        ]) {
            expect(docsSkill).toContain(phrase);
        }

        expect(docsSkill).toContain("This guard overrides implicit invocation");
        expect(sddSkill).toContain("request means **zero writes**");
    });

    it("keeps casual ideas local and persists only explicit capture or promotion", () => {
        expect(docsSkill).toContain("A casually shared raw idea stays in the current conversation");
        expect(docsSkill).toContain("Explicit “记录 / 保存” intent is itself a durable-capture gate");
        expect(docsSkill).toContain("product decision");
        expect(docsSkill).toMatch(/version or current-iteration/u);
        expect(docsSkill).toContain("cross-session research or execution");
        expect(docsSkill).toContain("one minimal `B-xxx` Backlog row");
    });

    it("removes the project Linear skill and external synchronization route", () => {
        expect(existsSync(join(repoRoot, ".agents/skills/pa-linear-product-manager/SKILL.md"))).toBe(false);
        expect(existsSync(join(repoRoot, ".agents/skills/pa-linear-product-manager/agents/openai.yaml"))).toBe(false);
        expect(docsSkill).not.toContain("`pa-linear-product-manager`");
        expect(docsSkill).not.toContain("Linear inbox");
        expect(docsSkill).toContain("Existing external links are historical");
    });

    it("uses progressive reads instead of preloading the documentation hierarchy", () => {
        expect(docsSkill).toContain("Read the minimum current authority needed");
        expect(docsSkill).toContain("Read a template only when creating that");
        expect(docsSkill).toContain("Do not preload Roadmap, every index, every contract, templates, or Archive");
    });

    it("routes plan-and-implement through validation without implicit closeout", () => {
        expect(docsSkill).toContain("Route “先规划并实现 / plan and implement” to `implement-approved-spec`");
        expect(docsSkill).toContain("must stop after validated implementation");
        expect(sddSkill).toContain("“Plan and implement” is not full-lifecycle authority");
        expect(sddSkill).toContain("implies closeout, archive, or commit");
        expect(sddSkill).toContain("full lifecycle / 完整生命周期 / 端到端做到收尾");
    });

    it("lets implement-approved-spec bootstrap a missing Plan and SDD", () => {
        expect(sddSkill).toContain("Plan/SDD may be missing");
        expect(sddSkill).toContain("Bootstrap required Plan/SDD");
        expect(sddSkill).toContain("Also run in `implement-approved-spec` when approved product");
        expect(sddSkill).toContain("bootstrap, not closeout authority");
        expect(sddSkill).toContain("do not convert the mode to");
    });

    it("routes repo-only governance without polluting PA Product Specs", () => {
        expect(docsContract).toContain("use Product Decision/Product Spec for work that changes PA runtime or user behavior");
        expect(docsContract).toContain("use a Governance Contract under `docs/development/governance/`");
        expect(docsContract).toContain("Never put internal governance gates into a Product Spec");
        expect(sddContract).toContain("Keep repo-only documentation/checker/CI/release-tooling/Agent-skill contracts");
        expect(sddContract).toContain("Use exactly one authority lane per Active Package");
        expect(sddContract).toContain("never disguise engineering governance as a Product Spec");
    });

    it("resolves continuation targets deterministically and asks once before writing if ambiguous", () => {
        expectInOrder(docsSkill, [
            "an explicit `B-xxx` or feature slug",
            "the Active Package already bound to the current conversation",
            "the only registered Active Package",
        ]);
        expect(docsSkill).toContain("perform zero writes until the user answers");
        expect(sddSkill).toContain("ask one target question and perform zero writes");
    });

    it("fails closed before an archive target collision can mutate source state", () => {
        expect(docsSkill).toContain("If that path already exists, fail closed");
        expect(docsSkill).toContain("overwrite, auto-suffix, move, or partially archive anything");
        expect(sddSkill).toContain("Before any terminal-status edit");
        expect(sddSkill).toContain("If the exact archive target already exists, fail closed");
        expect(sddSkill).toContain("overwrite, auto-suffix, change source statuses, or partially archive");
    });

    it("does not keep cancelled or superseded governance as current authority", () => {
        expect(docsContract).toContain("For a Closed governance track, keep its delivered Governance Contract current");
        expect(docsContract).toContain("For Cancelled/Superseded governance, archive the unshipped/superseded GOV as a direct annual record");
        expect(sddContract).toContain("archive Cancelled/Superseded governance records under the annual Archive");
    });

    it("asks one ordinary decision at a time and batches only after an explicit request", () => {
        expect(docsSkill).toContain("Ask at most one product or authorization question at a time");
        expect(docsSkill).toContain("explicit request for a decision queue; then return 3-5");
        expect(docsSkill).toContain("keep the request read-only until the user answers");
    });

    it("keeps the docs manager implicit and downstream skills explicitly routed", () => {
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

function expectInOrder(content: string, phrases: string[]): void {
    let previousIndex = -1;
    for (const phrase of phrases) {
        const index = content.indexOf(phrase);
        expect(index).toBeGreaterThan(previousIndex);
        previousIndex = index;
    }
}

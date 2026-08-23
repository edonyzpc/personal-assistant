import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const checker = join(process.cwd(), "scripts/check-docs.mjs");

describe("scripts/check-docs.mjs", () => {
    it("accepts the minimal Feature Home plus Tracker package", () => {
        expect(runCheck(createFixture())).toContain("Documentation check passed");
    });

    it("accepts optional Plan and SDD when complexity justifies them", () => {
        expect(runCheck(createFixture({ designArtifacts: true }))).toContain("Documentation check passed");
    });

    it("accepts a Governance package without Product authority", () => {
        expect(runCheck(createFixture({ governance: true }))).toContain("Documentation check passed");
    });

    it("rejects a package that mixes Governance and Product authority", () => {
        const repo = createFixture({ governance: true });
        const home = join(repo, "docs/development/active/sample/README.md");
        replace(home, "Tracker: [Tracker](./tracker.md)", "Decision: [DEC-001](../../../product/decisions/dec-001.md)\nTracker: [Tracker](./tracker.md)");

        expect(expectCheckFailure(repo)).toContain("package must declare exactly one authority lane");
    });

    it("keeps Tracker as the only delivery-status authority", () => {
        const repo = createFixture();
        const tracker = join(repo, "docs/development/active/sample/tracker.md");
        replace(tracker, "Delivery status: Implementing", "Delivery status: Validated");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("rejects delivery-status mirrors in Feature Home", () => {
        const repo = createFixture();
        const home = join(repo, "docs/development/active/sample/README.md");
        replace(home, "Document status: Current", "Document status: Current\nDelivery status: Implementing");

        expect(expectCheckFailure(repo)).toContain("Feature Home must not mirror Delivery status");
    });

    it("enforces one Now package", () => {
        const repo = createFixture();
        addActivePackage(repo, "second", "B-002", "Implementing");

        expect(expectCheckFailure(repo)).toContain("Active WIP limit exceeded: 2 Now packages");
    });

    it("enforces one planned Next package", () => {
        const repo = createFixture();
        replace(
            join(repo, "docs/development/active/sample/tracker.md"),
            "Delivery status: Implementing",
            "Delivery status: Planned",
        );
        addActivePackage(repo, "second", "B-002", "Planned");

        expect(expectCheckFailure(repo)).toContain("Active WIP limit exceeded: 2 Next packages");
    });

    it("rejects standalone Active handoff or closeout artifacts", () => {
        const repo = createFixture();
        write(repo, "docs/development/active/sample/handoff.md", "# Duplicate handoff\n");

        expect(expectCheckFailure(repo)).toContain("Active Package must use Tracker Current Snapshot");
    });

    it("requires an existing SDD to be approved once implementation starts", () => {
        const repo = createFixture({ designArtifacts: true });
        const sdd = join(repo, "docs/development/active/sample/sdd.md");
        replace(sdd, "Document status: Approved", "Document status: Draft");

        expect(expectCheckFailure(repo)).toContain("Implementing requires an Approved SDD");
    });

    it("validates local HTML href and media src targets in current docs", () => {
        const repo = createFixture();
        write(repo, "docs/assets/demo.png", "png fixture\n");
        append(repo, "docs/index.md", "\n<a href=\"./backlog.md\">Backlog</a>\n<img src='./assets/demo.png'>\n");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("rejects a missing current HTML target", () => {
        const repo = createFixture();
        append(repo, "docs/index.md", "\n<img src=\"./assets/missing.png\">\n");

        expect(expectCheckFailure(repo)).toContain("docs/index.md -> ./assets/missing.png");
    });

    it("does not let an unrelated same-basename file mask a current-doc deletion", () => {
        const repo = createFixture({ legacyWorkflow: true });
        unlinkSync(join(repo, "docs/development/workflows/legacy.md"));
        replace(join(repo, "docs/development/README.md"), "[Legacy](./workflows/legacy.md)\n", "");
        write(repo, "docs/archive/legacy.md", "# Unrelated\n");
        append(repo, "docs/index.md", "\n[Archive evidence](./archive/legacy.md)\n");

        expect(expectCheckFailure(repo)).toContain("Deleted Markdown lacks content-continuous move target or disposition record");
    });

    it("rejects a deletion disposition whose destination is external", () => {
        const repo = createFixture({ legacyWorkflow: true });
        unlinkSync(join(repo, "docs/development/workflows/legacy.md"));
        replace(join(repo, "docs/development/README.md"), "[Legacy](./workflows/legacy.md)\n", "");
        append(repo, "docs/archive/disposition-log.md", "\n| 2026-07-21 | `docs/development/workflows/legacy.md` | absorbed | [External](https://example.com) | claimed |\n");

        const output = expectCheckFailure(repo);
        expect(output).toContain("destination must be an existing repo-local Markdown file");
        expect(output).toContain("Deleted Markdown lacks content-continuous move target or disposition record");
    });

    it("accepts a current-doc deletion after explicit absorption", () => {
        const repo = createFixture({ legacyWorkflow: true });
        unlinkSync(join(repo, "docs/development/workflows/legacy.md"));
        replace(join(repo, "docs/development/README.md"), "[Legacy](./workflows/legacy.md)\n", "");
        append(repo, "docs/archive/disposition-log.md", "\n| 2026-07-21 | `docs/development/workflows/legacy.md` | deleted-after-absorption | [Workflow](../development/documentation-workflow.md) | current workflow absorbs the rule |\n");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("allows pruning an unlinked process draft without a disposition row", () => {
        const repo = createFixture({ unlinkedProcessDraft: true });
        unlinkSync(join(repo, "docs/development/workflows/unlinked-draft.md"));

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("still requires disposition for an unlinked process document with lifecycle metadata", () => {
        const repo = createFixture({ unlinkedGovernedDoc: true });
        unlinkSync(join(repo, "docs/development/workflows/unlinked-governed.md"));

        expect(expectCheckFailure(repo)).toContain("Deleted Markdown lacks content-continuous move target or disposition record");
    });

    it("ignores broken links originating inside retained Archive evidence", () => {
        const repo = createFixture({ archiveEvidence: true });
        append(repo, "docs/archive/evidence.md", "\n[Pruned companion](./missing-plan.md)\n");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("still rejects a current link to a missing Archive target", () => {
        const repo = createFixture();
        append(repo, "docs/index.md", "\n[Missing evidence](./archive/missing.md)\n");

        expect(expectCheckFailure(repo)).toContain("docs/index.md -> ./archive/missing.md");
    });

    it("rejects Archive noise with no inbound current link", () => {
        const repo = createFixture();
        write(repo, "docs/archive/noise.md", "# Noise\n");

        expect(expectCheckFailure(repo)).toContain("Archive evidence has no inbound link from current documentation or source");
    });

    it("allows pruning Archive evidence without per-file disposition backfill", () => {
        const repo = createFixture({ archiveEvidence: true });
        unlinkSync(join(repo, "docs/archive/evidence.md"));
        replace(join(repo, "docs/index.md"), "[Evidence](./archive/evidence.md)\n", "");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("fails closed when an explicit CI diff base is unavailable", () => {
        const output = expectCheckFailure(createFixture(), {
            DOCS_CHECK_BASE: "0000000000000000000000000000000000000000",
        });

        expect(output).toContain("deletion continuity cannot fail open");
    });

    it("reports an exact immutable known-finding baseline as advisory", () => {
        const repo = createFixture();
        addKnownArchitectureFinding(repo);
        writeKnownFindingsBaseline(repo);

        const output = runCheck(repo, { GITHUB_ACTIONS: "true" });

        expect(output).toContain("Documentation check passed");
        expect(output).toContain("2 exact known finding(s) remain advisory");
        expect(output).toContain("::warning title=Known documentation lifecycle findings::2 exact baseline finding(s) remain");
    });

    it("still fails when a new finding is absent from the exact baseline", () => {
        const repo = createFixture();
        addKnownArchitectureFinding(repo);
        writeKnownFindingsBaseline(repo);
        write(repo, "docs/architecture/unexpected.md", "# Unexpected\n");

        expect(expectCheckFailure(repo)).toContain("docs/architecture/unexpected.md");
    });

    it("fails when a known-finding source changes without baseline reconciliation", () => {
        const repo = createFixture();
        addKnownArchitectureFinding(repo);
        writeKnownFindingsBaseline(repo);
        append(repo, "docs/architecture/legacy.md", "\nChanged while still producing the same findings.\n");

        expect(expectCheckFailure(repo)).toContain("Known documentation findings baseline file drifted: docs/architecture/legacy.md");
    });

    it("fails when a resolved finding leaves a stale baseline entry", () => {
        const repo = createFixture();
        addKnownArchitectureFinding(repo);
        writeKnownFindingsBaseline(repo, {
            extraFindings: ["Unindexed architecture doc: docs/architecture/legacy.md via docs/architecture/another-index.md"],
        });

        expect(expectCheckFailure(repo)).toContain("Known documentation finding no longer occurs; remove its baseline entry");
    });

    it("rejects duplicate findings and non-exact baseline paths", () => {
        const repo = createFixture();
        addKnownArchitectureFinding(repo);
        const findings = knownArchitectureFindings();
        writeKnownFindingsBaseline(repo, {
            extraFindings: [findings[0]],
            lockedPath: "docs/architecture/**",
        });

        const output = expectCheckFailure(repo);
        expect(output).toContain("has an invalid exact path: docs/architecture/**");
        expect(output).toContain("contains a duplicate");
    });

    it("does not let a locked path prefix cover another document", () => {
        const repo = createFixture();
        addKnownArchitectureFinding(repo);
        write(repo, "docs/architecture/legacy.md-extra.md", "# Prefix collision\n");
        writeKnownFindingsBaseline(repo, {
            extraFindings: [
                "Unindexed architecture doc: docs/architecture/legacy.md-extra.md via docs/architecture/README.md",
                "Orphan documentation is not reachable from docs/index.md without traversing archive: docs/architecture/legacy.md-extra.md",
            ],
        });

        expect(expectCheckFailure(repo)).toContain("Known documentation finding does not name a locked file");
    });

    it("fails closed on malformed known-finding configuration", () => {
        const repo = createFixture();
        write(repo, "scripts/docs-check-known-findings.json", "{not-json\n");

        expect(expectCheckFailure(repo)).toContain("Known documentation findings baseline is invalid JSON");
    });

    it("fails when an exactly locked baseline file is missing", () => {
        const repo = createFixture();
        addKnownArchitectureFinding(repo);
        writeKnownFindingsBaseline(repo);
        unlinkSync(join(repo, "docs/architecture/legacy.md"));

        expect(expectCheckFailure(repo)).toContain("Known documentation findings baseline file is missing: docs/architecture/legacy.md");
    });

    it("rejects removing a Backlog ID without active or terminal authority", () => {
        const repo = createFixture({ backlogItem: true });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");

        expect(expectCheckFailure(repo)).toContain("Removed Backlog B-099 lacks an Active Package or terminal archive/closeout");
    });

    it("accepts terminal Archive evidence as a compact Backlog disposition", () => {
        const repo = createFixture({ archiveEvidence: true, backlogItem: true });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");
        append(repo, "docs/archive/evidence.md", "\nDelivery status: Closed\nWork item: B-099\n");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("accepts implementation only in a named owner-directed proposal lane", () => {
        const repo = createFixture({ backlogItem: true, backlogWorkItem: "B-101" });
        addProposal(repo, "Approved", "Implementing", {
            path: "operations-agent/operations-agent-step2-sdd.md",
            workItem: "B-101",
        });

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("keeps the owner-authorized Step 3 SDD in the fixed B-101 proposal lane", () => {
        const repo = createFixture({ backlogItem: true, backlogWorkItem: "B-101" });
        addProposal(repo, "Current", "Implementing", {
            path: "operations-agent/operations-agent-step3-sdd.md",
            workItem: "B-101",
        });

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it.each([
        "operations-agent/operations-agent-plan.md",
        "operations-agent/operations-agent-mode-sdd.md",
    ])("accepts the superseded historical B-101 lane after Backlog close: %s", (path) => {
        const repo = createFixture({ backlogItem: true, backlogWorkItem: "B-101" });
        addProposal(repo, "Current", "Superseded", { path, workItem: "B-101" });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("accepts terminal closure only in a named owner-directed proposal lane", () => {
        const repo = createFixture({ backlogItem: true, backlogWorkItem: "B-123" });
        addProposal(repo, "Current", "Closed", {
            path: "pagelet-agent/pagelet-agent-proposal.md",
            workItem: "B-123",
        });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");

        expect(runCheck(repo)).toContain("Documentation check passed");
    });

    it("rejects implementation state on an ordinary proposal", () => {
        const repo = createFixture({ backlogItem: true });
        addProposal(repo, "Current", "Implementing");

        expect(expectCheckFailure(repo)).toContain("invalid proposal Delivery status");
    });

    it("rejects Approved document state on an ordinary proposal", () => {
        const repo = createFixture({ backlogItem: true });
        addProposal(repo, "Approved", "Needs Decision");

        expect(expectCheckFailure(repo)).toContain("invalid Document status Approved");
    });

    it("does not grant the owner-directed exception to the wrong Work item", () => {
        const repo = createFixture({ backlogItem: true });
        addProposal(repo, "Current", "Implementing", {
            path: "operations-agent/operations-agent-step2-sdd.md",
        });

        const output = expectCheckFailure(repo);
        expect(output).toContain("owner-directed proposal Work item must remain B-101");
        expect(output).toContain("invalid proposal Delivery status");
    });

    it("does not let an ordinary terminal proposal close its Backlog item", () => {
        const repo = createFixture({ backlogItem: true });
        addProposal(repo, "Current", "Closed");
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");

        const output = expectCheckFailure(repo);
        expect(output).toContain("invalid proposal Delivery status");
        expect(output).toContain("Removed Backlog B-099 lacks an Active Package or terminal archive/closeout");
    });

    it("still requires non-terminal proposal work to remain in Backlog", () => {
        const repo = createFixture();
        addProposal(repo, "Current", "Needs Decision");

        expect(expectCheckFailure(repo)).toContain("proposal Work item is missing from Backlog");
    });

    it("does not let Archive links make an orphan current document reachable", () => {
        const repo = createFixture();
        write(repo, "docs/development/unknown/orphan.md", "# Orphan\n");
        append(repo, "docs/archive/README.md", "\n[Wrong lane](../development/unknown/orphan.md)\n");

        expect(expectCheckFailure(repo)).toContain("Orphan documentation is not reachable from docs/index.md without traversing archive");
    });

    it("validates every new Product Spec before Active delivery", () => {
        const repo = createFixture();
        write(repo, "docs/product/specs/future.md", "# Future Spec\n");
        append(repo, "docs/product/README.md", "\n[Future](./specs/future.md)\n");

        expect(expectCheckFailure(repo)).toContain("docs/product/specs/future.md -> missing or placeholder field: Document status");
    });
});

function createFixture(options: {
    archiveEvidence?: boolean;
    backlogItem?: boolean;
    backlogWorkItem?: string;
    designArtifacts?: boolean;
    governance?: boolean;
    legacyWorkflow?: boolean;
    unlinkedGovernedDoc?: boolean;
    unlinkedProcessDraft?: boolean;
} = {}): string {
    const repo = mkdtempSync(join(tmpdir(), "pa-docs-check-"));
    const packageAuthority = options.governance
        ? "Governance contract: [GOV-001](../../governance/gov-001.md)"
        : "Decision: [DEC-001](../../../product/decisions/dec-001.md)\nProduct spec: [Sample Spec](../../../product/specs/sample.md)";
    const artifactAuthority = options.governance
        ? "Governance contract: [GOV-001](../../governance/gov-001.md)"
        : "Product spec: [Sample Spec](../../../product/specs/sample.md)";
    const files: Record<string, string> = {
        "docs/index.md": `# Docs

[Backlog](./backlog.md)
[Roadmap](./development-roadmap.md)
[Product](./product/README.md)
[Architecture](./architecture/README.md)
[Development](./development/README.md)
[Guides](./guides/README.md)
[Operations](./operations/README.md)
[Archive](./archive/README.md)
${options.archiveEvidence ? "[Evidence](./archive/evidence.md)\n" : ""}`,
        "docs/backlog.md": options.backlogItem
            ? `# Backlog\n\n| ID | Item | Boundary | Next | Source |\n| --- | --- | --- | --- | --- |\n| ${options.backlogWorkItem ?? "B-099"} | Test | Test | Decide | User request 2026-07-21 |\n`
            : "# Backlog\n",
        "docs/development-roadmap.md": "# Roadmap\n",
        "docs/product/README.md": "# Product\n\n[Register](./active-decisions.md)\n[Decisions](./decisions/README.md)\n[Spec](./specs/sample.md)\n",
        "docs/product/active-decisions.md": "# Active Decisions\n\n## Active Product Decisions\n\n| ID | Decision | Boundary | Evidence | Trigger |\n| --- | --- | --- | --- | --- |\n| DEC-001 | Sample | Test | [Record](./decisions/dec-001.md) | Change |\n",
        "docs/product/decisions/README.md": "# Decisions\n\n| ID | Decision | Status | Scope | Record |\n| --- | --- | --- | --- | --- |\n| DEC-001 | Sample | Accepted | Test | [Record](./dec-001.md) |\n",
        "docs/product/decisions/dec-001.md": "# Decision\n\nDecision ID: DEC-001\nStatus: Accepted\nUpdated: 2026-07-21\nAuthority: Test\nWork item: B-001\n",
        "docs/product/specs/sample.md": "# Sample Spec\n\nDocument status: Approved\nUpdated: 2026-07-21\nWork item: B-001\nDecision: [DEC-001](../decisions/dec-001.md)\nAuthority: Product behavior\n\n## Requirements\n\n- B-001/REQ-01\n- B-001/AC-01\n",
        "docs/architecture/README.md": "# Architecture\n",
        "docs/development/README.md": `# Development

[Workflow](./documentation-workflow.md)
[Active](./active/README.md)
[Discovery](./discovery/README.md)
[Governance](./governance/README.md)
[Proposals](./proposals/README.md)
[Templates](./templates/README.md)
${options.legacyWorkflow ? "[Legacy](./workflows/legacy.md)\n" : ""}`,
        "docs/development/documentation-workflow.md": "# Workflow\n",
        "docs/development/active/README.md": "# Active\n\n| Track | Work item | Feature Home | Tracker |\n| --- | --- | --- | --- |\n| Sample | B-001 | [Home](./sample/README.md) | [Tracker](./sample/tracker.md) |\n",
        "docs/development/active/sample/README.md": `# Sample Track

Document status: Current
Updated: 2026-07-21
Work item: B-001
Authority: Routing
${packageAuthority}
Tracker: [Tracker](./tracker.md)

## Artifacts

[Tracker](./tracker.md)
${options.designArtifacts ? "[Plan](./plan.md)\n[SDD](./sdd.md)\n" : ""}`,
        "docs/development/active/sample/tracker.md": `# Tracker

Document status: Current
Delivery status: Implementing
Updated: 2026-07-21
Work item: B-001
Authority: Execution
${artifactAuthority}
${options.designArtifacts ? "Plan: [Plan](./plan.md)\nSDD: [SDD](./sdd.md)\n" : ""}
## Traceability

B-001/REQ-01
B-001/AC-01
`,
        "docs/development/discovery/README.md": "# Discovery\n",
        "docs/development/governance/README.md": options.governance ? "# Governance\n\n[GOV-001](./gov-001.md)\n" : "# Governance\n",
        "docs/development/proposals/README.md": "# Proposals\n",
        "docs/development/templates/README.md": "# Templates\n",
        "docs/guides/README.md": "# Guides\n",
        "docs/operations/README.md": "# Operations\n",
        "docs/archive/README.md": "# Archive\n\n[Disposition](./disposition-log.md)\n",
        "docs/archive/disposition-log.md": "# Disposition\n",
    };
    if (options.governance) {
        files["docs/development/governance/gov-001.md"] = "# Governance\n\nGovernance ID: GOV-001\nDocument status: Current\nUpdated: 2026-07-21\nWork item: B-001\nAuthority: Engineering\n\n## Requirements\n\n- B-001/REQ-01\n- B-001/AC-01\n";
    }
    if (options.designArtifacts) {
        files["docs/development/active/sample/plan.md"] = `# Plan

Document status: Approved
Updated: 2026-07-21
Work item: B-001
Authority: Plan
${artifactAuthority}
Tracker: [Tracker](./tracker.md)
`;
        files["docs/development/active/sample/sdd.md"] = `# SDD

Document status: Approved
Updated: 2026-07-21
Work item: B-001
Authority: Design
${artifactAuthority}
Plan: [Plan](./plan.md)
Tracker: [Tracker](./tracker.md)

## Traceability

B-001/REQ-01
B-001/AC-01
`;
    }
    if (options.archiveEvidence) files["docs/archive/evidence.md"] = "# Evidence\n";
    if (options.legacyWorkflow) files["docs/development/workflows/legacy.md"] = legacyDocument();
    if (options.unlinkedProcessDraft) {
        files["docs/development/workflows/unlinked-draft.md"] = "# One-off analysis\n\nNo stable identity or inbound link.\n";
    }
    if (options.unlinkedGovernedDoc) {
        files["docs/development/workflows/unlinked-governed.md"] = "# Governed\n\nDocument status: Current\nUpdated: 2026-07-21\nAuthority: Durable rule\n";
    }
    for (const [file, content] of Object.entries(files)) write(repo, file, content);

    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test User"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.hooksPath", "/dev/null"]);
    git(repo, ["add", "docs"]);
    git(repo, ["commit", "-m", "docs: seed fixture"]);
    return repo;
}

function legacyDocument(): string {
    return `# Legacy Document

This document preserves a substantial historical rule and rationale.

## Context

The original workflow had constraints that must survive a move.
It records scope, compatibility, rollback, and verification expectations.

## Decision

Delete only after current authority absorbs the unique information.
Otherwise add an explicit disposition pointing to repo-local authority.

## Evidence

The focused checker test verifies current-document continuity.
`;
}

function addKnownArchitectureFinding(repo: string): void {
    write(repo, "docs/architecture/legacy.md", "# Legacy architecture input\n");
}

function knownArchitectureFindings(): string[] {
    return [
        "Unindexed architecture doc: docs/architecture/legacy.md via docs/architecture/README.md",
        "Orphan documentation is not reachable from docs/index.md without traversing archive: docs/architecture/legacy.md",
    ];
}

function writeKnownFindingsBaseline(
    repo: string,
    options: { extraFindings?: string[]; lockedPath?: string } = {},
): void {
    const lockedPath = options.lockedPath ?? "docs/architecture/legacy.md";
    const lockedFile = join(repo, "docs/architecture/legacy.md");
    const sha256 = createHash("sha256").update(readFileSync(lockedFile)).digest("hex");
    write(
        repo,
        "scripts/docs-check-known-findings.json",
        `${JSON.stringify({
            version: 1,
            authority: "Test-only exact baseline",
            removeWhen: "Remove when the fixture finding disappears",
            groups: [{
                id: "legacy-architecture",
                reason: "Synthetic inherited finding",
                files: [{ path: lockedPath, sha256 }],
                findings: [...knownArchitectureFindings(), ...(options.extraFindings ?? [])],
            }],
        }, null, 2)}\n`,
    );
}

function addProposal(
    repo: string,
    documentStatus: "Approved" | "Current",
    deliveryStatus: "Needs Decision" | "Blocked" | "Implementing" | "Closed" | "Superseded",
    options: { path?: string; workItem?: string } = {},
): void {
    const proposalPath = options.path ?? "sample.md";
    const workItem = options.workItem ?? "B-099";
    write(
        repo,
        `docs/development/proposals/${proposalPath}`,
        `# Sample Proposal

Document status: ${documentStatus}
Delivery status: ${deliveryStatus}
Updated: 2026-07-21
Work item: ${workItem}
Authority: Owner-authorized proposal
Restart condition: Owner changes delivery state
`,
    );
    append(repo, "docs/development/proposals/README.md", `\n[Sample proposal](./${proposalPath})\n`);
}

function addActivePackage(repo: string, slug: string, workItem: string, status: "Planned" | "Implementing"): void {
    const ordinal = workItem.slice(2);
    const decisionId = `DEC-${ordinal}`;
    const decisionFile = `dec-${ordinal}.md`;
    const specFile = `${slug}.md`;
    write(
        repo,
        `docs/product/decisions/${decisionFile}`,
        `# Decision\n\nDecision ID: ${decisionId}\nStatus: Accepted\nUpdated: 2026-07-21\nAuthority: Test\nWork item: ${workItem}\n`,
    );
    append(
        repo,
        "docs/product/decisions/README.md",
        `| ${decisionId} | ${slug} | Accepted | Test | [Record](./${decisionFile}) |\n`,
    );
    append(
        repo,
        "docs/product/active-decisions.md",
        `| ${decisionId} | ${slug} | Test | [Record](./decisions/${decisionFile}) | Change |\n`,
    );
    write(
        repo,
        `docs/product/specs/${specFile}`,
        `# ${slug}\n\nDocument status: Approved\nUpdated: 2026-07-21\nWork item: ${workItem}\nDecision: [${decisionId}](../decisions/${decisionFile})\nAuthority: Product behavior\n\n## Requirements\n\n- ${workItem}/REQ-01\n- ${workItem}/AC-01\n`,
    );
    append(repo, "docs/product/README.md", `[${slug}](./specs/${specFile})\n`);
    write(
        repo,
        `docs/development/active/${slug}/README.md`,
        `# ${slug}\n\nDocument status: Current\nUpdated: 2026-07-21\nWork item: ${workItem}\nAuthority: Routing\nDecision: [${decisionId}](../../../product/decisions/${decisionFile})\nProduct spec: [Spec](../../../product/specs/${specFile})\nTracker: [Tracker](./tracker.md)\n\n[Tracker](./tracker.md)\n`,
    );
    write(
        repo,
        `docs/development/active/${slug}/tracker.md`,
        `# Tracker\n\nDocument status: Current\nDelivery status: ${status}\nUpdated: 2026-07-21\nWork item: ${workItem}\nAuthority: Execution\nProduct spec: [Spec](../../../product/specs/${specFile})\n\n${workItem}/REQ-01\n${workItem}/AC-01\n`,
    );
    append(
        repo,
        "docs/development/active/README.md",
        `| ${slug} | ${workItem} | [Home](./${slug}/README.md) | [Tracker](./${slug}/tracker.md) |\n`,
    );
}

function write(repo: string, file: string, content: string): void {
    const target = join(repo, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
}

function append(repo: string, file: string, content: string): void {
    const target = join(repo, file);
    writeFileSync(target, `${readFileSync(target, "utf8")}${content}`, "utf8");
}

function replace(file: string, from: string, to: string): void {
    writeFileSync(file, readFileSync(file, "utf8").replace(from, to), "utf8");
}

function runCheck(repo: string, extraEnv: NodeJS.ProcessEnv = {}): string {
    return execFileSync("node", [checker], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DOCS_CHECK_REPO_ROOT: repo, ...extraEnv },
        stdio: "pipe",
    });
}

function expectCheckFailure(repo: string, extraEnv: NodeJS.ProcessEnv = {}): string {
    try {
        runCheck(repo, extraEnv);
    } catch (error) {
        const commandError = error as { message: string; stdout?: string; stderr?: string };
        return [commandError.stdout ?? "", commandError.stderr ?? "", commandError.message].join("\n");
    }
    throw new Error("Expected documentation check to fail.");
}

function git(repo: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

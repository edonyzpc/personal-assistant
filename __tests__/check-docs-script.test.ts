import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative as relativePath } from "node:path";

const checker = join(process.cwd(), "scripts/check-docs.mjs");

describe("scripts/check-docs.mjs", () => {
    it("accepts a complete active package with repo-local approval links", () => {
        const repo = createFixture();

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("accepts an active Governance package without Product authority", () => {
        const repo = createFixture({ governance: true });

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("rejects a package that mixes Governance and Product authority", () => {
        const repo = createFixture({ governance: true });
        const home = join(repo, "docs/development/active/sample/README.md");
        writeFileSync(
            home,
            readFileSync(home, "utf8").replace("Tracker: [Tracker](./tracker.md)", "Decision: [DEC-001](../../../product/decisions/dec-001.md)\nTracker: [Tracker](./tracker.md)"),
            "utf8",
        );

        const output = expectCheckFailure(repo);

        expect(output).toContain("package must declare exactly one authority lane");
    });

    it("accepts a plan-only active package without fabricating an SDD", () => {
        const repo = createFixture({ planOnly: true });

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("rejects drift between Feature Home, Active Registry, and Tracker status", () => {
        const repo = createFixture();
        const tracker = join(repo, "docs/development/active/sample/tracker.md");
        writeFileSync(tracker, readFileSync(tracker, "utf8").replace("Delivery status: Implementing", "Delivery status: Validated"), "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("Feature Home and Tracker Delivery status differ");
    });

    it("rejects implementation that starts from a Draft Plan", () => {
        const repo = createFixture();
        const plan = join(repo, "docs/development/active/sample/plan.md");
        writeFileSync(plan, readFileSync(plan, "utf8").replace("Document status: Approved", "Document status: Draft"), "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("requires an Approved Plan");
    });

    it("validates local HTML href and media src targets", () => {
        const repo = createFixture();
        write(repo, "docs/assets/demo.png", "png fixture\n");
        write(repo, "docs/assets/demo.mp4", "video fixture\n");
        const index = join(repo, "docs/index.md");
        writeFileSync(
            index,
            `${readFileSync(index, "utf8")}\n<a href="./backlog.md">Backlog</a>\n<img src='./assets/demo.png'>\n<video src="./assets/demo.mp4"></video>\n<source src='./assets/demo.mp4'>\n`,
            "utf8",
        );

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("rejects a missing local HTML href or media src target", () => {
        const repo = createFixture();
        const index = join(repo, "docs/index.md");
        writeFileSync(index, `${readFileSync(index, "utf8")}\n<img src="./assets/missing.png">\n`, "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("docs/index.md -> ./assets/missing.png");
    });

    it("does not treat an unrelated same-basename template as a move target", () => {
        const repo = createFixture({ withDuplicatePlan: true });
        unlinkSync(join(repo, "docs/development/workflows/plan.md"));
        const developmentIndex = join(repo, "docs/development/README.md");
        writeFileSync(
            developmentIndex,
            readFileSync(developmentIndex, "utf8").replace("- [Workflow plan](./workflows/plan.md)\n", ""),
            "utf8",
        );

        const output = expectCheckFailure(repo);

        expect(output).toContain("Deleted Markdown lacks content-continuous move target or disposition record: docs/development/workflows/plan.md");
    });

    it("accepts an untracked move only when the destination preserves source content", () => {
        const repo = createFixture({ rootLegacy: true });
        unlinkSync(join(repo, "docs/legacy.md"));
        write(repo, "docs/archive/legacy.md", legacyDocument());
        append(repo, "docs/archive/README.md", "\n[Legacy](./legacy.md)\n");

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("does not treat an unrelated same-basename document as a move target", () => {
        const repo = createFixture({ rootLegacy: true });
        unlinkSync(join(repo, "docs/legacy.md"));
        write(repo, "docs/archive/legacy.md", "# Unrelated\n\nThis file does not preserve the deleted document.\n");
        append(repo, "docs/archive/README.md", "\n[Legacy](./legacy.md)\n");

        const output = expectCheckFailure(repo);

        expect(output).toContain("Deleted Markdown lacks content-continuous move target or disposition record: docs/legacy.md");
    });

    it("does not let a pre-existing content-identical document mask a deletion", () => {
        const repo = createFixture({ rootLegacy: true });
        write(repo, "docs/archive/legacy.md", legacyDocument());
        append(repo, "docs/archive/README.md", "\n[Legacy](./legacy.md)\n");
        git(repo, ["add", "docs/archive"]);
        git(repo, ["commit", "-m", "docs: preserve pre-existing legacy copy"]);
        unlinkSync(join(repo, "docs/legacy.md"));

        const output = expectCheckFailure(repo);

        expect(output).toContain("Deleted Markdown lacks content-continuous move target or disposition record: docs/legacy.md");
    });

    it("rejects a deletion disposition whose destination is not repo-local Markdown", () => {
        const repo = createFixture({ rootLegacy: true });
        unlinkSync(join(repo, "docs/legacy.md"));
        append(
            repo,
            "docs/archive/disposition-log.md",
            "\n| 2026-07-12 | `docs/legacy.md` | absorbed | [External](https://example.com/evidence) | Claimed elsewhere |\n",
        );

        const output = expectCheckFailure(repo);

        expect(output).toContain("destination must be an existing repo-local Markdown file");
        expect(output).toContain("Deleted Markdown lacks content-continuous move target or disposition record: docs/legacy.md");
    });

    it("rejects a structured archive package without completed disposition evidence", () => {
        const repo = createFixture();
        addArchivePackage(repo);

        const output = expectCheckFailure(repo);

        expect(output).toContain("Information Disposition has no completed disposition row");
    });

    it("rejects an unknown closeout disposition", () => {
        const repo = createFixture();
        addArchivePackage(repo, { completeDisposition: true });
        const closeout = join(repo, "docs/archive/2026/sample/closeout.md");
        writeFileSync(closeout, readFileSync(closeout, "utf8").replace("| archive |", "| archvie |"), "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("unknown Information Disposition archvie");
    });

    it("requires closeout disposition coverage for every process artifact", () => {
        const repo = createFixture();
        addArchivePackage(repo, { completeDisposition: true });
        const closeout = join(repo, "docs/archive/2026/sample/closeout.md");
        writeFileSync(
            closeout,
            readFileSync(closeout, "utf8").replace(/^\| `plan\.md`.*\n/mu, ""),
            "utf8",
        );

        const output = expectCheckFailure(repo);

        expect(output).toContain("Information Disposition omits package artifact plan.md");
    });

    it("rejects an archived package that points at another Work item's authority", () => {
        const repo = createFixture();
        addArchivePackage(repo, { completeDisposition: true, planOnly: true });
        for (const file of ["README.md", "plan.md", "tracker.md", "closeout.md"]) {
            const target = join(repo, "docs/archive/2026/sample", file);
            writeFileSync(target, readFileSync(target, "utf8").replace("Work item: B-001", "Work item: B-002"), "utf8");
        }

        const output = expectCheckFailure(repo);

        expect(output).toContain("archived Decision Work item mismatch");
    });

    it("accepts a cancelled plan-only archive without an invented SDD", () => {
        const repo = createFixture();
        addArchivePackage(repo, { completeDisposition: true, planOnly: true });

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("accepts a Closed Governance archive with consistent authority and traceability", () => {
        const repo = createFixture({ governance: true });
        addArchivePackage(repo, { completeDisposition: true, governance: true });

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("rejects a Cancelled Governance archive that still points to current authority", () => {
        const repo = createFixture({ governance: true, withoutActivePackage: true });
        addArchivePackage(repo, {
            completeDisposition: true,
            governance: true,
            governanceTerminal: "Cancelled",
            keepCurrentGovernance: true,
        });

        const output = expectCheckFailure(repo);

        expect(output).toContain("Cancelled Governance contract must be a direct annual archive record");
    });

    it("accepts a Cancelled Governance archive with a matching annual terminal record", () => {
        const repo = createFixture({ governance: true, withoutActivePackage: true });
        addArchivePackage(repo, { completeDisposition: true, governance: true, governanceTerminal: "Cancelled" });

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("accepts a Superseded Governance archive linked to a new current successor", () => {
        const repo = createFixture({ governance: true, withoutActivePackage: true });
        addArchivePackage(repo, {
            completeDisposition: true,
            governance: true,
            governanceSuccessor: true,
            governanceTerminal: "Superseded",
        });

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("rejects a Superseded Governance archive without a current successor", () => {
        const repo = createFixture({ governance: true, withoutActivePackage: true });
        addArchivePackage(repo, { completeDisposition: true, governance: true, governanceTerminal: "Superseded" });

        const output = expectCheckFailure(repo);

        expect(output).toContain("Superseded Governance record requires Successor governance");
    });

    it("rejects Governance template tokens left in an archived package", () => {
        const repo = createFixture({ governance: true });
        addArchivePackage(repo, { completeDisposition: true, governance: true });
        append(repo, "docs/archive/2026/sample/plan.md", "\nUnresolved template: GOV-xxx\n");

        const output = expectCheckFailure(repo);

        expect(output).toContain("archived package contains template tokens");
    });

    it("accepts a superseded plan-only archive with terminal annual authority", () => {
        const repo = createFixture();
        addArchivePackage(repo, { completeDisposition: true, planOnly: true });
        for (const file of [
            "docs/archive/2026/sample/README.md",
            "docs/archive/2026/sample/tracker.md",
            "docs/archive/2026/sample/closeout.md",
            "docs/archive/2026/sample-product-spec.md",
        ]) {
            const target = join(repo, file);
            writeFileSync(target, readFileSync(target, "utf8").split("Cancelled").join("Superseded"), "utf8");
        }
        const decision = join(repo, "docs/archive/2026/dec-099-cancel-sample.md");
        writeFileSync(decision, readFileSync(decision, "utf8").replace("Status: Rejected", "Status: Superseded"), "utf8");

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("rejects a cancelled package that keeps unshipped authority current", () => {
        const repo = createFixture();
        addArchivePackage(repo, { completeDisposition: true, planOnly: true });
        const replacements = new Map([
            ["[DEC-099](../dec-099-cancel-sample.md)", "[DEC-001](../../../product/decisions/dec-001.md)"],
            ["[Cancelled Sample Spec](../sample-product-spec.md)", "[Sample Spec](../../../product/specs/sample.md)"],
        ]);
        for (const file of ["README.md", "tracker.md", "closeout.md"]) {
            const target = join(repo, "docs/archive/2026/sample", file);
            let content = readFileSync(target, "utf8");
            for (const [source, destination] of replacements) content = content.replace(source, destination);
            writeFileSync(target, content, "utf8");
        }

        const output = expectCheckFailure(repo);

        expect(output).toContain("Cancelled archive Decision must be a direct annual archive record");
    });

    it("fails closed when an explicit CI diff base is unavailable", () => {
        const repo = createFixture();

        const output = expectCheckFailure(repo, { DOCS_CHECK_BASE: "0000000000000000000000000000000000000000" });

        expect(output).toContain("deletion continuity cannot fail open");
    });

    it("allows non-Markdown assets to move into the indexed asset directory", () => {
        const repo = createFixture({ assetAtRoot: true });
        mkdirSync(join(repo, "docs/assets"), { recursive: true });
        renameSync(join(repo, "docs/old.png"), join(repo, "docs/assets/old.png"));

        const output = runCheck(repo);

        expect(output).toContain("Documentation check passed");
    });

    it("rejects removing a Backlog ID without promotion or terminal closeout", () => {
        const repo = createFixture({ backlogItem: true });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("Removed Backlog B-099 lacks an Active Package or terminal archive/closeout");
    });

    it("rejects removing a technical Backlog ID without an explicit terminal path", () => {
        const repo = createFixture({ technicalBacklogItem: true });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("Removed Backlog T-099 lacks an Active Package or terminal archive/closeout");
    });

    it("does not let a standalone Closed archive record replace structured closeout", () => {
        const repo = createFixture({ backlogItem: true });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");
        write(repo, "docs/archive/2026/closed.md", "# Closed\n\nDocument status: Archived\nDelivery status: Closed\nUpdated: 2026-07-12\nWork item: B-099\nAuthority: Claimed terminal record\n");
        append(repo, "docs/archive/2026/README.md", "\n[Closed](./closed.md)\n");

        const output = expectCheckFailure(repo);

        expect(output).toContain("Closed work requires a structured archive package with closeout.md");
        expect(output).toContain("Removed Backlog B-099 lacks an Active Package or terminal archive/closeout");
    });

    it("does not let a standalone Cancelled Governance record replace an archived package", () => {
        const repo = createFixture({ backlogItem: true, withoutActivePackage: true });
        writeFileSync(join(repo, "docs/backlog.md"), "# Backlog\n", "utf8");
        write(repo, "docs/archive/2026/gov-099-cancelled.md", "# Cancelled Governance\n\nDocument status: Archived\nGovernance ID: GOV-099\nDelivery status: Cancelled\nUpdated: 2026-07-12\nWork item: B-099\nAuthority: Terminal engineering record\n\n## Requirements\n\n- B-099/REQ-01\n- B-099/AC-01\n");
        append(repo, "docs/archive/2026/README.md", "\n[GOV-099](./gov-099-cancelled.md)\n");

        const output = expectCheckFailure(repo);

        expect(output).toContain("Removed Backlog B-099 lacks an Active Package or terminal archive/closeout");
    });

    it("does not let Archive links make an orphan current document reachable", () => {
        const repo = createFixture();
        write(repo, "docs/development/unknown/orphan.md", "# Orphan\n");
        const archiveIndex = join(repo, "docs/archive/README.md");
        writeFileSync(archiveIndex, `${readFileSync(archiveIndex, "utf8")}\n[Wrong lane](../development/unknown/orphan.md)\n`, "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("Orphan documentation is not reachable from docs/index.md without traversing archive");
    });

    it("validates every future Product Spec before it enters an Active Package", () => {
        const repo = createFixture();
        write(repo, "docs/product/specs/future.md", "# Future Spec\n");
        const productIndex = join(repo, "docs/product/README.md");
        writeFileSync(productIndex, `${readFileSync(productIndex, "utf8")}\n[Future](./specs/future.md)\n`, "utf8");

        const output = expectCheckFailure(repo);

        expect(output).toContain("docs/product/specs/future.md -> missing or placeholder field: Document status");
    });

    it("rejects moving an Active Package artifact outside its exact annual archive path", () => {
        const repo = createFixture({ activeExtra: true });
        mkdirSync(join(repo, "docs/development/workflows"), { recursive: true });
        renameSync(
            join(repo, "docs/development/active/sample/notes.md"),
            join(repo, "docs/development/workflows/notes.md"),
        );
        const home = join(repo, "docs/development/active/sample/README.md");
        writeFileSync(home, readFileSync(home, "utf8").replace("[Notes](./notes.md)\n", ""), "utf8");
        const developmentIndex = join(repo, "docs/development/README.md");
        writeFileSync(developmentIndex, `${readFileSync(developmentIndex, "utf8")}\n[Notes](./workflows/notes.md)\n`, "utf8");
        git(repo, ["add", "-A", "docs"]);

        const output = expectCheckFailure(repo);

        expect(output).toContain("Active Package rename must preserve feature/file path in annual Archive");
    });

    it("does not accept a same-prefix sibling as a repo-local disposition destination", () => {
        const repo = createFixture();
        addArchivePackage(repo, { completeDisposition: true });
        const outsideFile = `${repo}-outside/evidence.md`;
        mkdirSync(dirname(outsideFile), { recursive: true });
        writeFileSync(outsideFile, "# Outside evidence\n", "utf8");
        const closeout = join(repo, "docs/archive/2026/sample/closeout.md");
        const outsideLink = relativePath(dirname(closeout), outsideFile);
        writeFileSync(
            closeout,
            readFileSync(closeout, "utf8").replace("[Feature Home](./README.md)", `[Outside](${outsideLink})`),
            "utf8",
        );

        const output = expectCheckFailure(repo);

        expect(output).toContain("disposition destination must be an existing repo-local Markdown file");
    });
});

function createFixture(options: {
    activeExtra?: boolean;
    assetAtRoot?: boolean;
    backlogItem?: boolean;
    governance?: boolean;
    planOnly?: boolean;
    rootLegacy?: boolean;
    technicalBacklogItem?: boolean;
    withoutActivePackage?: boolean;
    withDuplicatePlan?: boolean;
} = {}): string {
    const repo = mkdtempSync(join(tmpdir(), "pa-docs-check-"));
    const deliveryStatus = options.planOnly ? "Planned" : "Implementing";
    const designStatus = options.planOnly ? "Not started" : "Approved";
    const packageAuthority = options.governance
        ? "Governance contract: [GOV-001](../../governance/gov-001.md)"
        : "Decision: [DEC-001](../../../product/decisions/dec-001.md)\nProduct spec: [Sample Spec](../../../product/specs/sample.md)";
    const artifactAuthority = options.governance
        ? "Governance contract: [GOV-001](../../governance/gov-001.md)"
        : "Product spec: [Sample Spec](../../../product/specs/sample.md)";
    const backlogRows = [
        ...(options.backlogItem ? ["| B-099 | Test | Test | Decide | User request 2026-07-12 |"] : []),
        ...(options.technicalBacklogItem ? ["| T-099 | Technical trigger | Trigger not met | Observe | User request 2026-07-12 |"] : []),
    ];
    const backlog = backlogRows.length > 0
        ? `# Backlog\n\n| ID | Item | Boundary | Next | Source |\n| --- | --- | --- | --- | --- |\n${backlogRows.join("\n")}\n`
        : "# Backlog\n";
    const files: Record<string, string> = {
        "docs/index.md": `# Docs\n\n[Backlog](./backlog.md)\n[Roadmap](./development-roadmap.md)\n[Product](./product/README.md)\n[Architecture](./architecture/README.md)\n[Development](./development/README.md)\n[Guides](./guides/README.md)\n[Operations](./operations/README.md)\n[Archive](./archive/README.md)\n`,
        "docs/backlog.md": backlog,
        "docs/development-roadmap.md": "# Roadmap\n",
        "docs/product/README.md": `# Product\n\n[Register](./active-decisions.md)\n[Decisions](./decisions/README.md)\n[Spec](./specs/sample.md)\n`,
        "docs/product/active-decisions.md": `# Active Decisions\n\n## Active Product Decisions\n\n| ID | Decision | Boundary | Evidence | Trigger |\n| --- | --- | --- | --- | --- |\n| DEC-001 | Sample | Test | [Record](./decisions/dec-001.md) | Change |\n`,
        "docs/product/decisions/README.md": `# Decisions\n\n| ID | Decision | Status | Scope | Record |\n| --- | --- | --- | --- | --- |\n| DEC-001 | Sample | Accepted | Test | [Record](./dec-001.md) |\n`,
        "docs/product/decisions/dec-001.md": `# Decision\n\nDecision ID: DEC-001\nStatus: Accepted\nUpdated: 2026-07-12\nAuthority: Test authority\nWork item: B-001\n`,
        "docs/product/specs/sample.md": `# Sample Spec\n\nDocument status: Approved\nUpdated: 2026-07-12\nWork item: B-001\nDecision: [DEC-001](../decisions/dec-001.md)\nAuthority: Product behavior\n\n## Requirements\n\n- B-001/REQ-01\n- B-001/AC-01\n`,
        "docs/architecture/README.md": "# Architecture\n",
        "docs/development/README.md": `# Development\n\n[Workflow](./documentation-workflow.md)\n[Active](./active/README.md)\n[Discovery](./discovery/README.md)\n[Governance](./governance/README.md)\n[Proposals](./proposals/README.md)\n[Templates](./templates/README.md)\n${options.withDuplicatePlan ? "- [Workflow plan](./workflows/plan.md)\n" : ""}`,
        "docs/development/documentation-workflow.md": "# Workflow\n",
        "docs/development/active/README.md": `# Active\n\n| Track | Work item | Delivery status (derived) | Target | Updated | Feature Home / Tracker |\n| --- | --- | --- | --- | --- | --- |\n| Sample | B-001 | ${deliveryStatus} | vNext | 2026-07-12 | [Home](./sample/README.md) / [Tracker](./sample/tracker.md) |\n`,
        "docs/development/active/sample/README.md": `# Sample Track\n\nDocument status: Current\nDelivery status: ${deliveryStatus}\nDesign status: ${designStatus}\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Track routing\n${packageAuthority}\nTracker: [Tracker](./tracker.md)\n\n## Artifacts\n\n[Plan](./plan.md)\n${options.planOnly ? "" : "[SDD](./sdd.md)\n"}[Tracker](./tracker.md)\n${options.activeExtra ? "[Notes](./notes.md)\n" : ""}`,
        "docs/development/active/sample/plan.md": `# Plan\n\nDocument status: ${options.planOnly ? "Draft" : "Approved"}\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Delivery plan\n${artifactAuthority}\nTracker: [Tracker](./tracker.md)\n`,
        "docs/development/active/sample/tracker.md": `# Tracker\n\nDocument status: Current\nDelivery status: ${deliveryStatus}\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Execution status\n${artifactAuthority}\nPlan: [Plan](./plan.md)\n${options.planOnly ? "" : "SDD: [SDD](./sdd.md)\n"}\n## Traceability\n\nB-001/REQ-01\nB-001/AC-01\n`,
        "docs/development/discovery/README.md": "# Discovery\n",
        "docs/development/governance/README.md": options.governance ? "# Governance\n\n[GOV-001](./gov-001.md)\n" : "# Governance\n",
        "docs/development/proposals/README.md": "# Proposals\n",
        "docs/development/templates/README.md": options.withDuplicatePlan ? "# Templates\n\n[Plan](./plan.md)\n" : "# Templates\n",
        "docs/guides/README.md": "# Guides\n",
        "docs/operations/README.md": "# Operations\n",
        "docs/archive/README.md": "# Archive\n\n[Disposition](./disposition-log.md)\n[2026](./2026/README.md)\n",
        "docs/archive/disposition-log.md": "# Disposition\n",
        "docs/archive/2026/README.md": "# 2026\n",
    };
    if (options.governance) {
        files["docs/development/governance/gov-001.md"] = "# Governance Contract\n\nGovernance ID: GOV-001\nDocument status: Approved\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Engineering workflow contract\n\n## Requirements\n\n- B-001/REQ-01\n- B-001/AC-01\n";
    }
    if (!options.planOnly) {
        files["docs/development/active/sample/sdd.md"] = `# SDD\n\nDocument status: Approved\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Design\n${artifactAuthority}\nPlan: [Plan](./plan.md)\nTracker: [Tracker](./tracker.md)\n\n## Traceability\n\nB-001/REQ-01\nB-001/AC-01\n`;
    }
    if (options.withoutActivePackage) {
        files["docs/development/active/README.md"] = "# Active\n\n当前没有活跃开发包。\n\n| Track | Work item | Delivery status (derived) | Target | Updated | Feature Home / Tracker |\n| --- | --- | --- | --- | --- | --- |\n";
        delete files["docs/development/active/sample/README.md"];
        delete files["docs/development/active/sample/plan.md"];
        delete files["docs/development/active/sample/sdd.md"];
        delete files["docs/development/active/sample/tracker.md"];
    }
    if (options.withDuplicatePlan) {
        files["docs/development/workflows/plan.md"] = "# Workflow Plan\n";
        files["docs/development/templates/plan.md"] = "# Template Plan\n";
    }
    if (options.activeExtra) files["docs/development/active/sample/notes.md"] = "# Active Notes\n";
    if (options.assetAtRoot) files["docs/old.png"] = "png fixture\n";
    if (options.rootLegacy) files["docs/legacy.md"] = legacyDocument();
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

function addArchivePackage(repo: string, options: {
    completeDisposition?: boolean;
    governance?: boolean;
    governanceSuccessor?: boolean;
    governanceTerminal?: "Cancelled" | "Closed" | "Superseded";
    keepCurrentGovernance?: boolean;
    planOnly?: boolean;
} = {}): void {
    const finalStatus = options.governanceTerminal ?? (options.planOnly ? "Cancelled" : "Closed");
    const designStatus = options.planOnly ? "Not started" : "Approved";
    const decisionLink = options.planOnly ? "[DEC-099](../dec-099-cancel-sample.md)" : "[DEC-001](../../../product/decisions/dec-001.md)";
    const specLink = options.planOnly ? "[Cancelled Sample Spec](../sample-product-spec.md)" : "[Sample Spec](../../../product/specs/sample.md)";
    const terminalGovernance = options.governance && finalStatus !== "Closed" && !options.keepCurrentGovernance;
    const governanceLink = terminalGovernance
        ? "[GOV-001](../gov-001-sample.md)"
        : "[GOV-001](../../../development/governance/gov-001.md)";
    const homeAuthority = options.governance
        ? `Governance contract: ${governanceLink}`
        : `Decision: ${decisionLink}\nProduct spec: ${specLink}`;
    const artifactAuthority = options.governance
        ? `Governance contract: ${governanceLink}`
        : `Product spec: ${specLink}`;
    const closeoutAuthority = options.governance
        ? `Governance contract: ${governanceLink}`
        : `Decision: ${decisionLink}\nProduct spec: ${specLink}`;
    const annualRecords = [
        ...(options.planOnly && !options.governance
            ? ["[DEC-099](./dec-099-cancel-sample.md)", "[Cancelled Sample Spec](./sample-product-spec.md)"]
            : []),
        ...(terminalGovernance ? ["[GOV-001 terminal](./gov-001-sample.md)"] : []),
    ].join("\n");
    if (terminalGovernance) {
        const currentGovernance = join(repo, "docs/development/governance/gov-001.md");
        let archivedGovernance = readFileSync(currentGovernance, "utf8")
            .replace("Document status: Approved", `Document status: Archived\nDelivery status: ${finalStatus}`);
        if (options.governanceSuccessor) {
            write(repo, "docs/development/governance/gov-002.md", "# Successor Governance Contract\n\nGovernance ID: GOV-002\nDocument status: Current\nUpdated: 2026-07-12\nWork item: B-002\nAuthority: Successor engineering workflow contract\n\n## Requirements\n\n- B-002/REQ-01\n- B-002/AC-01\n");
            write(repo, "docs/development/governance/README.md", "# Governance\n\n[GOV-002](./gov-002.md)\n");
            archivedGovernance = archivedGovernance.replace(
                /^(Authority:.*)$/mu,
                "$1\nSuccessor governance: [GOV-002](../../development/governance/gov-002.md)",
            );
        } else {
            write(repo, "docs/development/governance/README.md", "# Governance\n");
        }
        unlinkSync(currentGovernance);
        write(repo, "docs/archive/2026/gov-001-sample.md", archivedGovernance);
        append(
            repo,
            "docs/archive/disposition-log.md",
            "\n| 2026-07-12 | `docs/development/governance/gov-001.md` | absorbed | [Archived GOV-001](./2026/gov-001-sample.md) | Governance authority moved to its terminal annual record |\n",
        );
    }
    write(repo, "docs/archive/2026/README.md", `# 2026\n\n[Sample](./sample/README.md)\n${annualRecords}\n`);
    if (options.planOnly && !options.governance) {
        write(repo, "docs/archive/2026/dec-099-cancel-sample.md", "# Cancel Sample Decision\n\nDocument status: Archived\nDecision ID: DEC-099\nStatus: Rejected\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Terminal product decision\n");
        write(repo, "docs/archive/2026/sample-product-spec.md", "# Cancelled Sample Spec\n\nDocument status: Archived\nDelivery status: Cancelled\nUpdated: 2026-07-12\nWork item: B-001\nDecision: [DEC-099](./dec-099-cancel-sample.md)\nAuthority: Unshipped product contract\n");
    }
    write(repo, "docs/archive/2026/sample/README.md", `# Archived Sample\n\nDocument status: Archived\nDelivery status: ${finalStatus}\nDesign status: ${designStatus}\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Archive home\n${homeAuthority}\nTracker: [Tracker](./tracker.md)\n\n[Plan](./plan.md)\n${options.planOnly ? "" : "[SDD](./sdd.md)\n"}[Tracker](./tracker.md)\n[Closeout](./closeout.md)\n`);
    write(repo, "docs/archive/2026/sample/plan.md", `${archivedArtifact("Plan")}${artifactAuthority}\n`);
    if (!options.planOnly) {
        write(repo, "docs/archive/2026/sample/sdd.md", `${archivedArtifact("SDD")}${artifactAuthority}\n\n## Traceability\n\nB-001/REQ-01\nB-001/AC-01\n`);
    }
    write(repo, "docs/archive/2026/sample/tracker.md", `${archivedArtifact("Tracker")}Delivery status: ${finalStatus}\n${artifactAuthority}\nPlan: [Plan](./plan.md)\n\n## Traceability\n\nB-001/REQ-01\nB-001/AC-01\n`);
    const dispositionRows = options.completeDisposition
        ? [
            "| `README.md` | Feature routing | [Feature Home](./README.md) | archive | Preserved with closeout |",
            "| `plan.md` | Delivery plan | [Plan](./plan.md) | archive | Preserved with closeout |",
            "| `tracker.md` | Execution evidence | [Tracker](./tracker.md) | archive | Preserved with closeout |",
            ...(!options.planOnly
                ? ["| `sdd.md` | Implementation design | [SDD](./sdd.md) | archive | Preserved with closeout |"]
                : []),
        ].join("\n")
        : "";
    write(repo, "docs/archive/2026/sample/closeout.md", `${archivedArtifact("Closeout")}Delivery status: ${finalStatus}\n${closeoutAuthority}\n\n## Information Disposition\n\n| Source | Unique | Destination | Disposition | Why |\n| --- | --- | --- | --- | --- |\n${dispositionRows}\n`);
}

function archivedArtifact(title: string): string {
    return `# ${title}\n\nDocument status: Archived\nUpdated: 2026-07-12\nWork item: B-001\nAuthority: Archived evidence\n`;
}

function legacyDocument(): string {
    return `# Legacy Document

This document preserves a substantial historical decision and its rationale.

## Context

The original workflow had several constraints that must survive a move.
It records the user outcome, the implementation boundary, and the evidence.
It also records compatibility, rollback, and verification expectations.

## Decision

Keep every unique statement when reorganizing the documentation tree.
Move the document only when the destination preserves its complete content.
Otherwise add an explicit disposition record pointing to current authority.

## Evidence

The focused regression test verifies content continuity for untracked moves.
The deletion audit must fail closed when the destination is unrelated.
`;
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

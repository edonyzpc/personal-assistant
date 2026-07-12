import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.env.DOCS_CHECK_REPO_ROOT || process.cwd());
const docsRoot = path.join(repoRoot, "docs");
const errors = [];
const warnings = [];
let checkedLinks = 0;
const resolvedLinksByFile = new Map();

function walkFiles(directory, predicate) {
    if (!existsSync(directory)) return [];
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(target, predicate));
        if (entry.isFile() && predicate(target)) files.push(target);
    }
    return files;
}

function walkMarkdown(directory) {
    return walkFiles(directory, (file) => file.endsWith(".md"));
}

function directMarkdown(directory) {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
        .map((entry) => path.join(directory, entry.name));
}

function relative(file) {
    return path.relative(repoRoot, file).split(path.sep).join("/");
}

function withoutFencedCode(markdown) {
    return markdown
        .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "")
        .replace(/`[^`\n]*`/g, "");
}

function normalizeTarget(rawTarget) {
    const targetWithoutTitle = rawTarget.trim().split(/\s+["']/u, 1)[0];
    const unwrapped = targetWithoutTitle.startsWith("<") && targetWithoutTitle.endsWith(">")
        ? targetWithoutTitle.slice(1, -1)
        : targetWithoutTitle;
    const withoutAnchor = unwrapped.split("#", 1)[0].split("?", 1)[0];
    try {
        return decodeURIComponent(withoutAnchor);
    } catch {
        return withoutAnchor;
    }
}

function isExternalTarget(rawTarget) {
    return rawTarget.startsWith("#")
        || rawTarget.startsWith("//")
        || /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget);
}

function resolveTarget(file, target) {
    if (target.startsWith("/")) return path.resolve(repoRoot, `.${target}`);
    return path.resolve(path.dirname(file), target);
}

function collectLocalTarget(file, rawTarget, targets) {
    if (isExternalTarget(rawTarget)) return;
    const target = normalizeTarget(rawTarget);
    if (!target) return;
    checkedLinks += 1;
    const resolved = resolveTarget(file, target);
    targets.add(resolved);
    if (!existsSync(resolved)) errors.push(`${relative(file)} -> ${rawTarget}`);
}

function collectMarkdownLinks(file, rawMarkdown) {
    const targets = new Set();
    const markdown = withoutFencedCode(rawMarkdown);
    const linkPattern = /\]\(([^)]+)\)/g;
    for (const match of markdown.matchAll(linkPattern)) {
        collectLocalTarget(file, match[1], targets);
    }
    const htmlTagPattern = /<(a|img|video|source)\b[^>]*>/giu;
    for (const tagMatch of markdown.matchAll(htmlTagPattern)) {
        const tag = tagMatch[1].toLowerCase();
        const attribute = tag === "a" ? "href" : "src";
        const attributePattern = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "iu");
        const attributeMatch = tagMatch[0].match(attributePattern);
        if (attributeMatch) collectLocalTarget(file, attributeMatch[2], targets);
    }
    resolvedLinksByFile.set(file, targets);
}

function requireIndexed(indexFile, files, label) {
    if (!existsSync(indexFile)) {
        errors.push(`Missing index: ${relative(indexFile)}`);
        return;
    }
    const targets = resolvedLinksByFile.get(indexFile) ?? new Set();
    for (const file of files) {
        if (!targets.has(file)) errors.push(`Unindexed ${label}: ${relative(file)} via ${relative(indexFile)}`);
    }
}

function metadataBlock(content) {
    return content.split(/^##\s+/mu, 1)[0];
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function field(content, label) {
    const escaped = escapeRegExp(label);
    return metadataBlock(content).match(new RegExp(`^${escaped}:\\s*(.+)$`, "mi"))?.[1]?.trim();
}

function requireFields(file, labels) {
    const content = readFileSync(file, "utf8");
    for (const label of labels) {
        const value = field(content, label);
        if (!value || /<[^>]+>|YYYY-MM-DD|replace with/iu.test(value)) {
            errors.push(`${relative(file)} -> missing or placeholder field: ${label}`);
        }
    }
    const updated = field(content, "Updated");
    if (labels.includes("Updated") && !/^\d{4}-\d{2}-\d{2}$/u.test(updated ?? "")) {
        errors.push(`${relative(file)} -> invalid Updated date ${updated ?? ""}`);
    }
    return content;
}

function linkedFieldTarget(file, content, label) {
    const value = field(content, label) ?? "";
    const rawTarget = value.match(/\]\(([^)]+)\)/u)?.[1];
    if (!rawTarget || /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)) {
        errors.push(`${relative(file)} -> ${label} must be a repo-local Markdown link`);
        return undefined;
    }
    const normalized = normalizeTarget(rawTarget);
    if (!normalized) {
        errors.push(`${relative(file)} -> ${label} has an empty link`);
        return undefined;
    }
    const target = path.resolve(path.dirname(file), normalized);
    if (!existsSync(target) || path.extname(target) !== ".md" || !statSync(target).isFile()) {
        errors.push(`${relative(file)} -> ${label} must target an existing Markdown file: ${rawTarget}`);
        return undefined;
    }
    return target;
}

function repoLocalMarkdownTargets(sourceFile, text) {
    return [...text.matchAll(/\]\(([^)]+)\)/g)].flatMap((match) => {
        if (isExternalTarget(match[1])) return [];
        const normalized = normalizeTarget(match[1]);
        if (!normalized) return [];
        const target = resolveTarget(sourceFile, normalized);
        const repoLocal = target.startsWith(`${repoRoot}${path.sep}`);
        if (!repoLocal || !existsSync(target) || path.extname(target) !== ".md" || !statSync(target).isFile()) return [];
        return [target];
    });
}

function hasRepoLocalMarkdownLink(sourceFile, text) {
    return repoLocalMarkdownTargets(sourceFile, text).length > 0;
}

function validateDocumentStatus(file, content, allowed) {
    const status = field(content, "Document status");
    if (!allowed.includes(status)) errors.push(`${relative(file)} -> invalid Document status ${status ?? ""}`);
}

function requireLinks(file, targets, label) {
    const links = resolvedLinksByFile.get(file) ?? new Set();
    for (const target of targets) {
        if (!links.has(target)) errors.push(`${relative(file)} -> missing ${label} link: ${relative(target)}`);
    }
}

function tableRowLinking(indexFile, target) {
    for (const line of readFileSync(indexFile, "utf8").split("\n")) {
        if (!line.trimStart().startsWith("|")) continue;
        for (const match of line.matchAll(/\]\(([^)]+)\)/g)) {
            const normalized = normalizeTarget(match[1]);
            if (normalized && path.resolve(path.dirname(indexFile), normalized) === target) {
                return line.split("|").slice(1, -1).map((cell) => cell.trim());
            }
        }
    }
    return undefined;
}

const rootMarkdown = [
    "AGENTS.md",
    "CHANGELOG.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "README.md",
    "README-CN.md",
].map((file) => path.join(repoRoot, file)).filter(existsSync);

const markdownFiles = [
    ...walkMarkdown(docsRoot),
    ...walkMarkdown(path.join(repoRoot, ".agents")),
    ...rootMarkdown,
];

for (const file of markdownFiles) collectMarkdownLinks(file, readFileSync(file, "utf8"));

const textExtensions = new Set([".md", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".pcss", ".css", ".json", ".yaml", ".yml"]);
const textRoots = ["docs", ".agents", "src", "__tests__", "scripts", ".github"]
    .map((directory) => path.join(repoRoot, directory));
const textFiles = [
    ...new Set([
        ...textRoots.flatMap((directory) => walkFiles(directory, (file) => textExtensions.has(path.extname(file)))),
        ...rootMarkdown,
        path.join(repoRoot, "package.json"),
    ].filter(existsSync)),
];

for (const file of textFiles) {
    const relativeFile = relative(file);
    if (relativeFile.startsWith("docs/archive/")) continue;
    if (relativeFile === "__tests__/check-docs-script.test.ts") continue; // Synthetic fixture paths intentionally do not exist in the real tree.
    const raw = readFileSync(file, "utf8");
    const repoPathPattern = /(?:^|[^A-Za-z0-9_.\/-])(docs\/[A-Za-z0-9_.\/-]+\.md)/g;
    for (const match of raw.matchAll(repoPathPattern)) {
        const referencedPath = match[1];
        if (!existsSync(path.join(repoRoot, referencedPath))) {
            errors.push(`${relativeFile} -> stale path ${referencedPath}`);
        }
    }
}

const allowedRootMarkdown = new Set(["backlog.md", "development-roadmap.md", "index.md"]);
const allowedRootDirectories = new Set(["architecture", "archive", "assets", "development", "guides", "operations", "product"]);
for (const entry of readdirSync(docsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !allowedRootDirectories.has(entry.name)) {
        errors.push(`Unexpected docs directory: docs/${entry.name}`);
    }
}
const actualRootMarkdown = readdirSync(docsRoot)
    .filter((name) => name.endsWith(".md") && statSync(path.join(docsRoot, name)).isFile());
for (const file of actualRootMarkdown) {
    if (!allowedRootMarkdown.has(file)) errors.push(`Unexpected root Markdown: docs/${file}`);
}
for (const file of allowedRootMarkdown) {
    if (!actualRootMarkdown.includes(file)) errors.push(`Missing root entry: docs/${file}`);
}

const index = (target) => path.join(docsRoot, target);
requireIndexed(index("index.md"), [
    index("backlog.md"),
    index("development-roadmap.md"),
    index("product/README.md"),
    index("architecture/README.md"),
    index("development/README.md"),
    index("guides/README.md"),
    index("operations/README.md"),
    index("archive/README.md"),
], "root entry");

requireIndexed(index("product/README.md"), [
    ...directMarkdown(index("product")),
    ...directMarkdown(index("product/specs")),
    index("product/decisions/README.md"),
], "product doc");
requireIndexed(index("product/decisions/README.md"), directMarkdown(index("product/decisions")), "decision record");
requireIndexed(index("architecture/README.md"), directMarkdown(index("architecture")), "architecture doc");
requireIndexed(index("development/README.md"), [
    ...directMarkdown(index("development")),
    ...directMarkdown(index("development/workflows")),
    ...directMarkdown(index("development/validation")),
    index("development/active/README.md"),
    index("development/discovery/README.md"),
    index("development/governance/README.md"),
    index("development/proposals/README.md"),
    index("development/templates/README.md"),
], "development doc");
const proposalIndex = index("development/proposals/README.md");
const proposalFiles = walkMarkdown(index("development/proposals")).filter((file) => file !== proposalIndex);
requireIndexed(proposalIndex, proposalFiles, "proposal doc");
requireIndexed(index("development/discovery/README.md"), directMarkdown(index("development/discovery")), "discovery brief");
const governanceRoot = index("development/governance");
const governanceIndex = index("development/governance/README.md");
const governanceFiles = directMarkdown(governanceRoot);
requireIndexed(governanceIndex, governanceFiles, "governance contract");
requireIndexed(index("development/templates/README.md"), directMarkdown(index("development/templates")), "documentation template");
requireIndexed(index("guides/README.md"), directMarkdown(index("guides")), "guide");
requireIndexed(index("operations/README.md"), directMarkdown(index("operations")), "operations doc");

function collectReachable(start, allowed) {
    const reachable = new Set();
    const queue = [start];
    while (queue.length > 0) {
        const file = queue.shift();
        if (!file || reachable.has(file) || !allowed(file)) continue;
        reachable.add(file);
        for (const target of resolvedLinksByFile.get(file) ?? []) {
            if (target.endsWith(".md") && !reachable.has(target) && allowed(target)) queue.push(target);
        }
    }
    return reachable;
}

const archivePrefix = `${index("archive")}${path.sep}`;
const currentReachableDocs = collectReachable(index("index.md"), (file) =>
    file.startsWith(`${docsRoot}${path.sep}`) && !file.startsWith(archivePrefix));
const archiveReachableDocs = collectReachable(index("archive/README.md"), (file) =>
    file === index("archive/README.md") || file.startsWith(archivePrefix));
const reachableDocs = new Set([...currentReachableDocs, ...archiveReachableDocs]);
for (const file of walkMarkdown(docsRoot)) {
    const expectedReachable = file.startsWith(archivePrefix) ? archiveReachableDocs : currentReachableDocs;
    const sourceIndex = file.startsWith(archivePrefix) ? "docs/archive/README.md" : "docs/index.md without traversing archive";
    if (!expectedReachable.has(file)) errors.push(`Orphan documentation is not reachable from ${sourceIndex}: ${relative(file)}`);
}

for (const file of proposalFiles) {
    const content = requireFields(file, ["Document status", "Delivery status", "Updated", "Work item", "Authority", "Restart condition"]);
    validateDocumentStatus(file, content, ["Current"]);
    if (!/^B-\d{3}$/u.test(field(content, "Work item") ?? "")) errors.push(`${relative(file)} -> invalid proposal Work item`);
    if (!["Needs Decision", "Blocked"].includes(field(content, "Delivery status"))) errors.push(`${relative(file)} -> invalid proposal Delivery status`);
}

const backlog = readFileSync(index("backlog.md"), "utf8");
const backlogIds = [];
for (const line of backlog.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const first = cells[0] ?? "";
    if (/^(?:B|T)-/u.test(first) && !/^(?:B|T)-\d{3}$/u.test(first)) {
        errors.push(`Malformed Backlog ID: ${first}`);
        continue;
    }
    if (!/^(?:B|T)-\d{3}$/u.test(first)) continue;
    backlogIds.push(first);
    const sourceCell = cells.at(-1) ?? "";
    const repoLocalSource = [...sourceCell.matchAll(/\]\(([^)]+)\)/g)].some((match) => {
        const normalized = normalizeTarget(match[1]);
        if (!normalized || /^[a-z][a-z0-9+.-]*:/iu.test(match[1])) return false;
        const target = path.resolve(path.dirname(index("backlog.md")), normalized);
        return (target === repoRoot || target.startsWith(`${repoRoot}${path.sep}`)) && existsSync(target);
    });
    const userRequestSource = /^User request \d{4}-\d{2}-\d{2}$/u.test(sourceCell);
    if (!repoLocalSource && !userRequestSource) errors.push(`Backlog ${first} needs a repo-local evidence link or dated User request source`);
    if (/\bComplete\b/iu.test(line)) errors.push(`Backlog ${first} contains terminal Complete state`);
}
for (const id of new Set(backlogIds)) {
    if (backlogIds.filter((candidate) => candidate === id).length > 1) errors.push(`Duplicate Backlog ID: ${id}`);
}
const backlogIdSet = new Set(backlogIds);
for (const file of proposalFiles) {
    const workItem = field(readFileSync(file, "utf8"), "Work item");
    if (!backlogIdSet.has(workItem)) errors.push(`${relative(file)} -> proposal Work item is missing from Backlog`);
}

function traceabilityIds(content, workItem) {
    return [...new Set(content.match(new RegExp(`${escapeRegExp(workItem ?? "")}/(?:REQ|AC)-\\d+`, "gu")) ?? [])];
}

function requireNamespacedTraceability(file, content, workItem, label) {
    const ids = traceabilityIds(content, workItem);
    if (!ids.some((id) => id.includes("/REQ-")) || !ids.some((id) => id.includes("/AC-"))) {
        errors.push(`${relative(file)} -> ${label} needs namespaced requirement and acceptance IDs`);
    }
    return ids;
}

const governanceContracts = new Map();
const governanceIds = new Set();
for (const file of governanceFiles) {
    const content = requireFields(file, ["Governance ID", "Document status", "Updated", "Work item", "Authority"]);
    const governanceId = field(content, "Governance ID");
    const workItem = field(content, "Work item");
    if (!/^GOV-\d{3}$/u.test(governanceId ?? "")) errors.push(`${relative(file)} -> invalid Governance ID ${governanceId ?? ""}`);
    if (governanceIds.has(governanceId)) errors.push(`Duplicate Governance ID: ${governanceId}`);
    governanceIds.add(governanceId);
    validateDocumentStatus(file, content, ["Current", "Approved"]);
    if (!/^B-\d{3}$/u.test(workItem ?? "")) errors.push(`${relative(file)} -> invalid Governance Work item ${workItem ?? ""}`);
    const ids = requireNamespacedTraceability(file, content, workItem, "Governance contract");
    governanceContracts.set(file, { content, governanceId, ids, workItem });
}

function resolvePackageAuthority(file, content) {
    const decision = field(content, "Decision");
    const productSpec = field(content, "Product spec");
    const governanceContract = field(content, "Governance contract");
    const productLane = Boolean(decision && productSpec && !governanceContract);
    const governanceLane = Boolean(governanceContract && !decision && !productSpec);
    if (!productLane && !governanceLane) {
        errors.push(`${relative(file)} -> package must declare exactly one authority lane: Decision + Product spec, or Governance contract`);
        return { kind: "invalid" };
    }
    if (governanceLane) {
        return { kind: "governance", governanceTarget: linkedFieldTarget(file, content, "Governance contract") };
    }
    return {
        kind: "product",
        decisionTarget: linkedFieldTarget(file, content, "Decision"),
        specTarget: linkedFieldTarget(file, content, "Product spec"),
    };
}

function requireConsistentArtifactAuthority(file, content, authority, options = {}) {
    if (authority.kind === "governance") {
        requireFields(file, ["Governance contract"]);
        if (field(content, "Decision") || field(content, "Product spec")) {
            errors.push(`${relative(file)} -> Governance package artifact must not declare Product authority fields`);
        }
        const target = linkedFieldTarget(file, content, "Governance contract");
        if (target !== authority.governanceTarget) errors.push(`${relative(file)} -> Governance contract differs from Feature Home`);
        return;
    }
    if (authority.kind === "product") {
        requireFields(file, ["Product spec", ...(options.includeDecision ? ["Decision"] : [])]);
        if (field(content, "Governance contract")) errors.push(`${relative(file)} -> Product package artifact must not declare Governance contract`);
        const specTarget = linkedFieldTarget(file, content, "Product spec");
        if (specTarget !== authority.specTarget) errors.push(`${relative(file)} -> Product spec differs from Feature Home`);
        if (options.includeDecision) {
            const decisionTarget = linkedFieldTarget(file, content, "Decision");
            if (decisionTarget !== authority.decisionTarget) errors.push(`${relative(file)} -> Decision differs from Feature Home`);
        }
    }
}

const activeRoot = index("development/active");
const activeIndex = index("development/active/README.md");
const activeIndexTargets = resolvedLinksByFile.get(activeIndex) ?? new Set();
const activeDeliveryStatuses = new Set(["Planned", "Implementing", "Validating", "Validated", "Blocked"]);
const promotedWorkItems = new Set();
const activeDirectories = readdirSync(activeRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
const activeIndexContent = readFileSync(activeIndex, "utf8");
if (activeDirectories.length > 0 && activeIndexContent.includes("当前没有活跃开发包")) {
    errors.push("Active Registry still claims there are no active packages");
}
for (const entry of activeDirectories) {
    const packageRoot = path.join(activeRoot, entry.name);
    const homeFile = path.join(packageRoot, "README.md");
    const planFile = path.join(packageRoot, "plan.md");
    const trackerFile = path.join(packageRoot, "tracker.md");
    const sddFile = path.join(packageRoot, "sdd.md");
    const required = [homeFile, planFile, trackerFile];
    for (const file of required) {
        if (!existsSync(file)) errors.push(`Incomplete active package ${entry.name}: missing ${path.basename(file)}`);
    }
    if (required.some((file) => !existsSync(file))) continue;
    if (!activeIndexTargets.has(homeFile) || !activeIndexTargets.has(trackerFile)) {
        errors.push(`Unregistered active package or tracker: ${relative(homeFile)}`);
    }

    const home = requireFields(homeFile, ["Document status", "Delivery status", "Design status", "Updated", "Work item", "Authority", "Tracker"]);
    const packageAuthority = resolvePackageAuthority(homeFile, home);
    const workItem = field(home, "Work item");
    const deliveryStatus = field(home, "Delivery status");
    const designStatus = field(home, "Design status");
    validateDocumentStatus(homeFile, home, ["Current"]);
    if (!/^B-\d{3}$/u.test(workItem ?? "")) errors.push(`${relative(homeFile)} -> invalid Work item ${workItem ?? ""}`);
    if (!activeDeliveryStatuses.has(deliveryStatus)) errors.push(`${relative(homeFile)} -> terminal or invalid active Delivery status ${deliveryStatus ?? ""}`);
    if (!["Not started", "Draft", "Approved"].includes(designStatus)) errors.push(`${relative(homeFile)} -> invalid Design status ${designStatus ?? ""}`);
    if (["Draft", "Approved"].includes(designStatus) && !existsSync(sddFile)) errors.push(`${relative(homeFile)} -> Design status ${designStatus} requires sdd.md`);
    if (designStatus === "Not started" && existsSync(sddFile)) errors.push(`${relative(homeFile)} -> sdd.md exists while Design status is Not started`);
    if (["Implementing", "Validating", "Validated"].includes(deliveryStatus) && designStatus !== "Approved") {
        errors.push(`${relative(homeFile)} -> ${deliveryStatus} requires Approved design`);
    }

    const registryRow = tableRowLinking(activeIndex, homeFile);
    if (!registryRow || registryRow[1] !== workItem || registryRow[2] !== deliveryStatus) {
        errors.push(`${relative(homeFile)} -> Active Registry Work item/status mirror is missing or stale`);
    }

    requireLinks(homeFile, [planFile, trackerFile], "active artifact");
    if (existsSync(sddFile)) requireLinks(homeFile, [sddFile], "SDD");

    const plan = requireFields(planFile, ["Document status", "Updated", "Work item", "Authority", "Tracker"]);
    requireConsistentArtifactAuthority(planFile, plan, packageAuthority);
    const trackerLabels = ["Document status", "Delivery status", "Updated", "Work item", "Authority", "Plan"];
    if (existsSync(sddFile)) trackerLabels.push("SDD");
    const tracker = requireFields(trackerFile, trackerLabels);
    requireConsistentArtifactAuthority(trackerFile, tracker, packageAuthority);
    validateDocumentStatus(planFile, plan, ["Draft", "Approved", "Current"]);
    validateDocumentStatus(trackerFile, tracker, ["Current"]);
    if ((designStatus === "Approved" || deliveryStatus !== "Planned") && field(plan, "Document status") !== "Approved") {
        errors.push(`${relative(planFile)} -> ${deliveryStatus}/${designStatus} requires an Approved Plan`);
    }
    if (field(plan, "Work item") !== workItem || field(tracker, "Work item") !== workItem) {
        errors.push(`${relative(homeFile)} -> Active artifact Work item mismatch`);
    }
    if (field(tracker, "Delivery status") !== deliveryStatus) {
        errors.push(`${relative(homeFile)} -> Feature Home and Tracker Delivery status differ`);
    }
    requireLinks(planFile, [trackerFile], "tracker");
    requireLinks(trackerFile, [planFile], "plan");

    let sdd;
    if (existsSync(sddFile)) {
        sdd = requireFields(sddFile, ["Document status", "Updated", "Work item", "Authority", "Plan", "Tracker"]);
        requireConsistentArtifactAuthority(sddFile, sdd, packageAuthority);
        validateDocumentStatus(sddFile, sdd, ["Draft", "Approved"]);
        if (field(sdd, "Work item") !== workItem) errors.push(`${relative(sddFile)} -> Work item differs from Feature Home`);
        if (designStatus === "Approved" && field(sdd, "Document status") !== "Approved") errors.push(`${relative(sddFile)} -> approved design requires Document status Approved`);
        requireLinks(sddFile, [planFile, trackerFile], "plan/tracker");
        requireLinks(trackerFile, [sddFile], "SDD");
    }

    let authorityTraceabilityIds = [];
    let authorityTraceabilityLabel = "Authority";
    if (packageAuthority.kind === "product") {
        const { decisionTarget, specTarget } = packageAuthority;
        if (decisionTarget && path.dirname(decisionTarget) !== index("product/decisions")) {
            errors.push(`${relative(homeFile)} -> Decision must target docs/product/decisions/`);
        }
        let decisionId;
        if (decisionTarget?.endsWith(".md")) {
            const decision = requireFields(decisionTarget, ["Decision ID", "Status", "Updated", "Authority", "Work item"]);
            decisionId = field(decision, "Decision ID");
            if (field(decision, "Status") !== "Accepted") errors.push(`${relative(homeFile)} -> linked Decision is not Accepted`);
            if (field(decision, "Work item") !== workItem) errors.push(`${relative(homeFile)} -> Decision Work item mismatch`);
        }
        if (specTarget && path.dirname(specTarget) !== index("product/specs")) {
            errors.push(`${relative(homeFile)} -> Product spec must target docs/product/specs/`);
        }
        if (specTarget?.endsWith(".md")) {
            const spec = requireFields(specTarget, ["Document status", "Updated", "Work item", "Decision", "Authority"]);
            validateDocumentStatus(specTarget, spec, ["Approved", "Current"]);
            if (field(spec, "Work item") !== workItem) errors.push(`${relative(homeFile)} -> Product Spec Work item mismatch`);
            const specDecisionTarget = linkedFieldTarget(specTarget, spec, "Decision");
            if (decisionTarget && specDecisionTarget !== decisionTarget) errors.push(`${relative(homeFile)} -> Product Spec and Feature Home Decision differ`);
            if (decisionId && !metadataBlock(spec).includes(decisionId)) errors.push(`${relative(specTarget)} -> Product Spec metadata omits ${decisionId}`);
            authorityTraceabilityIds = requireNamespacedTraceability(specTarget, spec, workItem, "Product Spec");
            authorityTraceabilityLabel = "Product Spec";
        }
    } else if (packageAuthority.kind === "governance") {
        const governanceTarget = packageAuthority.governanceTarget;
        if (governanceTarget && path.dirname(governanceTarget) !== governanceRoot) {
            errors.push(`${relative(homeFile)} -> Governance contract must target docs/development/governance/`);
        }
        const governance = governanceContracts.get(governanceTarget);
        if (!governance) {
            errors.push(`${relative(homeFile)} -> linked Governance contract is not a registered direct GOV document`);
        } else {
            if (governance.workItem !== workItem) errors.push(`${relative(homeFile)} -> Governance contract Work item mismatch`);
            authorityTraceabilityIds = governance.ids;
            authorityTraceabilityLabel = "Governance contract";
        }
    }
    for (const id of authorityTraceabilityIds) {
        if (!tracker.includes(id)) errors.push(`${relative(trackerFile)} -> missing ${authorityTraceabilityLabel} traceability ID ${id}`);
        if (sdd && !sdd.includes(id)) errors.push(`${relative(sddFile)} -> missing ${authorityTraceabilityLabel} traceability ID ${id}`);
    }
    if (/^B-\d{3}$/u.test(workItem ?? "")) promotedWorkItems.add(workItem);
}

const discoveryFiles = directMarkdown(index("development/discovery"));
const discoveryIndex = index("development/discovery/README.md");
const discoveryIndexContent = readFileSync(discoveryIndex, "utf8");
if (discoveryFiles.length > 0 && discoveryIndexContent.includes("当前没有活跃 Discovery Brief")) {
    errors.push("Discovery Registry still claims there are no active briefs");
}
for (const file of discoveryFiles) {
    const content = requireFields(file, ["Document status", "Delivery status", "Updated", "Work item", "Authority"]);
    const workItem = field(content, "Work item");
    const status = field(content, "Delivery status");
    validateDocumentStatus(file, content, ["Current"]);
    if (!/^B-\d{3}$/u.test(workItem ?? "")) errors.push(`${relative(file)} -> invalid Work item ${workItem ?? ""}`);
    if (workItem && !backlogIdSet.has(workItem)) errors.push(`${relative(file)} -> Discovery Work item is missing from Backlog`);
    if (!["Exploring", "Needs Decision", "Blocked"].includes(status)) errors.push(`${relative(file)} -> terminal or invalid discovery status ${status ?? ""}`);
    const registryRow = tableRowLinking(discoveryIndex, file);
    if (!registryRow || registryRow[0] !== workItem || registryRow[2] !== status) {
        errors.push(`${relative(file)} -> Discovery Registry Work item/status mirror is missing or stale`);
    }
}

const decisionFiles = directMarkdown(index("product/decisions"));
const decisionIds = new Set();
const activeDecisions = readFileSync(index("product/active-decisions.md"), "utf8");
const registerRows = new Map();
let registerSectionStatus;
for (const line of activeDecisions.split("\n")) {
    if (/^## Active (?:Product|Architecture) Decisions/u.test(line)) registerSectionStatus = "Accepted";
    if (/^## Deferred Decisions/u.test(line)) registerSectionStatus = "Deferred";
    const cells = line.trimStart().startsWith("|") ? line.split("|").slice(1, -1).map((cell) => cell.trim()) : [];
    if (/^DEC-\d{3}$/u.test(cells[0] ?? "") && registerSectionStatus) {
        if (registerRows.has(cells[0])) errors.push(`Duplicate Active Decision Register ID: ${cells[0]}`);
        registerRows.set(cells[0], { status: registerSectionStatus, cells });
    }
}
const legacyDecisionWorkItems = new Map([
    ["DEC-001", "Historical SPEC-05"],
    ["DEC-003", "Historical product boundary"],
    ["DEC-005", "Historical Memory governance"],
    ["DEC-011", "Historical capability boundary"],
]);
for (const file of decisionFiles) {
    const content = requireFields(file, ["Decision ID", "Status", "Updated", "Authority", "Work item"]);
    const id = field(content, "Decision ID");
    const status = field(content, "Status");
    const workItem = field(content, "Work item");
    if (!/^DEC-\d{3}$/u.test(id ?? "")) errors.push(`${relative(file)} -> invalid Decision ID ${id ?? ""}`);
    if (decisionIds.has(id)) errors.push(`Duplicate Decision ID: ${id}`);
    decisionIds.add(id);
    if (!["Proposed", "Accepted", "Deferred", "Rejected", "Superseded"].includes(status)) errors.push(`${relative(file)} -> invalid decision status ${status ?? ""}`);
    if (["Rejected", "Superseded"].includes(status)) errors.push(`${relative(file)} -> historical decision must move to annual Archive`);
    if (!/^B-\d{3}$/u.test(workItem ?? "") && legacyDecisionWorkItems.get(id) !== workItem) errors.push(`${relative(file)} -> invalid Decision Work item ${workItem ?? ""}`);
    if (status === "Deferred" && workItem && !backlogIdSet.has(workItem)) errors.push(`${relative(file)} -> Deferred decision Work item is missing from Backlog`);
    if (["Accepted", "Deferred"].includes(status) && registerRows.get(id)?.status !== status) {
        errors.push(`${relative(file)} -> ${status} decision missing or misclassified in Active Decision Register`);
    }
    if (status === "Proposed" && registerRows.has(id)) errors.push(`${relative(file)} -> Proposed decision must not appear in Active Decision Register`);
    const indexRow = tableRowLinking(index("product/decisions/README.md"), file);
    if (!indexRow || indexRow[0] !== id || indexRow[2] !== status) {
        errors.push(`${relative(file)} -> Decision Index ID/status is missing or stale`);
    }
}
if (/~\/\.claude\/projects|Exported from Claude Code memory|Source of truth:\s*~\//u.test(activeDecisions)) {
    errors.push("Active Decision Register cannot delegate authority to machine-local memory");
}

// These Product Specs predate the documentation workflow metadata contract. Keep the
// exception explicit so every newly added spec is validated without forcing a risky
// historical rewrite. Remove entries as legacy specs are deliberately modernized.
const legacyProductSpecBasenames = new Set([
    "pa-active-vault-indexer-product-spec.md",
    "pa-context-pager-product-spec.md",
    "pa-data-boundary-product-spec.md",
    "pa-eval-harness-product-spec.md",
    "pa-lightweight-graph-discovery-product-spec.md",
    "pa-memory-control-center-product-spec.md",
    "pa-memory-type-taxonomy-product-spec.md",
    "pa-quick-capture-micronote-product-spec.md",
    "pa-quiet-recall-insight-timing-product-spec.md",
    "pa-retrieval-habit-profile-product-spec.md",
    "pa-saved-insight-ledger-product-spec.md",
    "pa-scope-recap-theme-summary-product-spec.md",
    "pagelet-bubble-readiness-and-recall-product-spec.md",
    "pagelet-delivery-preparation-consolidation-product-note.md",
]);
for (const file of directMarkdown(index("product/specs"))) {
    if (legacyProductSpecBasenames.has(path.basename(file))) continue;
    const spec = requireFields(file, ["Document status", "Updated", "Work item", "Decision", "Authority"]);
    const workItem = field(spec, "Work item");
    validateDocumentStatus(file, spec, ["Draft", "Approved", "Current"]);
    if (!/^B-\d{3}$/u.test(workItem ?? "")) errors.push(`${relative(file)} -> invalid Product Spec Work item ${workItem ?? ""}`);
    const decisionTarget = linkedFieldTarget(file, spec, "Decision");
    if (decisionTarget && path.dirname(decisionTarget) !== index("product/decisions")) {
        errors.push(`${relative(file)} -> Product Spec Decision must target docs/product/decisions/`);
    }
    if (decisionTarget) {
        const decision = requireFields(decisionTarget, ["Decision ID", "Status", "Updated", "Authority", "Work item"]);
        if (field(decision, "Status") !== "Accepted") errors.push(`${relative(file)} -> Product Spec Decision is not Accepted`);
        if (field(decision, "Work item") !== workItem) errors.push(`${relative(file)} -> Product Spec Decision Work item mismatch`);
    }
    const traceabilityIds = [...new Set(spec.match(new RegExp(`${escapeRegExp(workItem ?? "")}/(?:REQ|AC)-\\d+`, "gu")) ?? [])];
    if (!traceabilityIds.some((id) => id.includes("/REQ-")) || !traceabilityIds.some((id) => id.includes("/AC-"))) {
        errors.push(`${relative(file)} -> Product Spec needs namespaced requirement and acceptance IDs`);
    }
}

const archiveRoot = index("archive");
const archiveIndex = index("archive/README.md");
const closedWorkItems = new Set();
const annualGovernanceRecords = new Map();
const archivedGovernanceIds = new Set();
const annualDirectories = readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}$/u.test(entry.name));
requireIndexed(archiveIndex, [
    ...directMarkdown(archiveRoot),
    ...annualDirectories.map((entry) => path.join(archiveRoot, entry.name, "README.md")),
], "archive entry");

for (const annual of annualDirectories) {
    const annualRoot = path.join(archiveRoot, annual.name);
    const annualIndex = path.join(annualRoot, "README.md");
    const trackDirectories = readdirSync(annualRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const annualRecords = directMarkdown(annualRoot);
    if (trackDirectories.length > 0 && readFileSync(annualIndex, "utf8").includes("当前没有使用新 package 结构归档的 track")) {
        errors.push(`${relative(annualIndex)} -> index still claims there are no structured tracks`);
    }
    requireIndexed(annualIndex, [
        ...annualRecords,
        ...trackDirectories.map((entry) => path.join(annualRoot, entry.name, "README.md")),
    ], `${annual.name} archive entry`);

    for (const file of annualRecords) {
        const content = requireFields(file, ["Document status", "Updated", "Work item", "Authority"]);
        validateDocumentStatus(file, content, ["Archived"]);
        const deliveryStatus = field(content, "Delivery status");
        const decisionStatus = field(content, "Status");
        const governanceId = field(content, "Governance ID");
        if (deliveryStatus === "Closed") {
            errors.push(`${relative(file)} -> Closed work requires a structured archive package with closeout.md`);
        } else if (deliveryStatus && !["Rejected", "Cancelled", "Superseded"].includes(deliveryStatus)) {
            errors.push(`${relative(file)} -> annual archive record has non-terminal Delivery status`);
        }
        if (decisionStatus && !["Rejected", "Superseded"].includes(decisionStatus)) {
            errors.push(`${relative(file)} -> annual archive decision has non-historical Status`);
        }
        if (!deliveryStatus && !decisionStatus) errors.push(`${relative(file)} -> annual archive record needs a terminal Delivery status or Decision Status`);
        if (governanceId) {
            requireFields(file, ["Governance ID", "Delivery status"]);
            const workItem = field(content, "Work item");
            if (!/^GOV-\d{3}$/u.test(governanceId)) errors.push(`${relative(file)} -> invalid archived Governance ID ${governanceId}`);
            if (governanceIds.has(governanceId)) errors.push(`${relative(file)} -> archived Governance ID ${governanceId} still exists as current authority`);
            if (archivedGovernanceIds.has(governanceId)) errors.push(`Duplicate archived Governance ID: ${governanceId}`);
            archivedGovernanceIds.add(governanceId);
            if (!/^B-\d{3}$/u.test(workItem ?? "")) errors.push(`${relative(file)} -> invalid archived Governance Work item ${workItem ?? ""}`);
            if (!["Cancelled", "Superseded"].includes(deliveryStatus)) {
                errors.push(`${relative(file)} -> archived Governance record must be Cancelled or Superseded`);
            }
            const ids = requireNamespacedTraceability(file, content, workItem, "Archived Governance record");
            const successorValue = field(content, "Successor governance");
            let successorTarget;
            if (deliveryStatus === "Superseded") {
                if (!successorValue) {
                    errors.push(`${relative(file)} -> Superseded Governance record requires Successor governance`);
                } else {
                    successorTarget = linkedFieldTarget(file, content, "Successor governance");
                    if (successorTarget && path.dirname(successorTarget) !== governanceRoot) {
                        errors.push(`${relative(file)} -> Successor governance must target docs/development/governance/`);
                    }
                    const successor = governanceContracts.get(successorTarget);
                    if (!successor) errors.push(`${relative(file)} -> Successor governance is not a registered current GOV document`);
                    if (successor?.governanceId === governanceId) errors.push(`${relative(file)} -> Superseded Governance successor must use a new Governance ID`);
                }
            } else if (deliveryStatus === "Cancelled" && successorValue) {
                errors.push(`${relative(file)} -> Cancelled Governance record must not declare Successor governance`);
            }
            annualGovernanceRecords.set(file, { deliveryStatus, governanceId, ids, successorTarget, workItem });
        }
        const terminalStandaloneRecord = ["Rejected", "Cancelled", "Superseded"].includes(deliveryStatus)
            || ["Rejected", "Superseded"].includes(decisionStatus);
        if (!governanceId && terminalStandaloneRecord && /^B-\d{3}$/u.test(field(content, "Work item") ?? "")) {
            closedWorkItems.add(field(content, "Work item"));
        }
    }

    for (const track of trackDirectories) {
        const trackRoot = path.join(annualRoot, track.name);
        const homeFile = path.join(trackRoot, "README.md");
        const planFile = path.join(trackRoot, "plan.md");
        const trackerFile = path.join(trackRoot, "tracker.md");
        const closeoutFile = path.join(trackRoot, "closeout.md");
        const sddFile = path.join(trackRoot, "sdd.md");
        const required = [homeFile, planFile, trackerFile, closeoutFile];
        for (const file of required) {
            if (!existsSync(file)) errors.push(`Incomplete archived package ${annual.name}/${track.name}: missing ${path.basename(file)}`);
        }
        if (required.some((file) => !existsSync(file))) continue;
        const home = requireFields(homeFile, ["Document status", "Delivery status", "Design status", "Updated", "Work item", "Authority", "Tracker"]);
        const packageAuthority = resolvePackageAuthority(homeFile, home);
        const workItem = field(home, "Work item");
        const terminalStatus = field(home, "Delivery status");
        const designStatus = field(home, "Design status");
        if (!/^B-\d{3}$/u.test(workItem ?? "")) errors.push(`${relative(homeFile)} -> invalid archived Work item`);
        if (!["Closed", "Cancelled", "Superseded"].includes(terminalStatus)) {
            errors.push(`${relative(homeFile)} -> archived package has non-terminal Delivery status`);
        }
        if (!["Not started", "Draft", "Approved"].includes(designStatus)) errors.push(`${relative(homeFile)} -> invalid archived Design status`);
        if (["Draft", "Approved"].includes(designStatus) && !existsSync(sddFile)) errors.push(`${relative(homeFile)} -> archived Design status requires sdd.md`);
        if (designStatus === "Not started" && existsSync(sddFile)) errors.push(`${relative(homeFile)} -> plan-only archive must not contain an untracked SDD`);

        const packageFiles = [...required, ...(existsSync(sddFile) ? [sddFile] : [])];
        requireIndexed(homeFile, packageFiles.slice(1), `${track.name} archived artifact`);
        for (const file of packageFiles) {
            const content = requireFields(file, ["Document status", "Updated", "Work item", "Authority"]);
            validateDocumentStatus(file, content, ["Archived"]);
            if (field(content, "Work item") !== workItem) errors.push(`${relative(file)} -> archived Work item mismatch`);
            if (/\b(?:B-xxx|DEC-xxx|GOV-xxx|YYYY-MM-DD)\b|replace with/iu.test(content)) errors.push(`${relative(file)} -> archived package contains template tokens`);
        }

        const plan = readFileSync(planFile, "utf8");
        const tracker = requireFields(trackerFile, ["Delivery status", "Plan"]);
        const closeout = requireFields(closeoutFile, ["Delivery status"]);
        requireConsistentArtifactAuthority(planFile, plan, packageAuthority);
        requireConsistentArtifactAuthority(trackerFile, tracker, packageAuthority);
        if (existsSync(sddFile)) requireConsistentArtifactAuthority(sddFile, readFileSync(sddFile, "utf8"), packageAuthority);
        requireConsistentArtifactAuthority(closeoutFile, closeout, packageAuthority, { includeDecision: true });
        if (field(tracker, "Delivery status") !== terminalStatus || field(closeout, "Delivery status") !== terminalStatus) {
            errors.push(`${relative(homeFile)} -> archived Home/Tracker/Closeout status mismatch`);
        }
        if (packageAuthority.kind === "product") {
            const { decisionTarget, specTarget } = packageAuthority;
            if (terminalStatus === "Closed") {
                if (decisionTarget && path.dirname(decisionTarget) !== index("product/decisions")) {
                    errors.push(`${relative(homeFile)} -> closed archive Decision must target docs/product/decisions/`);
                }
                if (decisionTarget) {
                    const decision = requireFields(decisionTarget, ["Decision ID", "Status", "Updated", "Authority", "Work item"]);
                    if (field(decision, "Status") !== "Accepted") errors.push(`${relative(homeFile)} -> archived authority Decision is not Accepted`);
                    if (field(decision, "Work item") !== workItem) errors.push(`${relative(homeFile)} -> archived Decision Work item mismatch`);
                }
                if (specTarget && path.dirname(specTarget) !== index("product/specs")) {
                    errors.push(`${relative(homeFile)} -> closed archive Product spec must target docs/product/specs/`);
                }
                if (specTarget) {
                    const spec = requireFields(specTarget, ["Document status", "Updated", "Work item", "Decision", "Authority"]);
                    validateDocumentStatus(specTarget, spec, ["Approved", "Current"]);
                    if (field(spec, "Work item") !== workItem) errors.push(`${relative(homeFile)} -> archived Product Spec Work item mismatch`);
                    if (linkedFieldTarget(specTarget, spec, "Decision") !== decisionTarget) errors.push(`${relative(homeFile)} -> archived Product Spec Decision mismatch`);
                }
            } else {
                const expectedDecisionStatus = terminalStatus === "Cancelled" ? "Rejected" : "Superseded";
                if (decisionTarget && path.dirname(decisionTarget) !== annualRoot) {
                    errors.push(`${relative(homeFile)} -> ${terminalStatus} archive Decision must be a direct annual archive record`);
                }
                if (decisionTarget) {
                    const decision = requireFields(decisionTarget, ["Document status", "Decision ID", "Status", "Updated", "Authority", "Work item"]);
                    validateDocumentStatus(decisionTarget, decision, ["Archived"]);
                    if (field(decision, "Status") !== expectedDecisionStatus) {
                        errors.push(`${relative(homeFile)} -> ${terminalStatus} archive Decision must be ${expectedDecisionStatus}`);
                    }
                    if (field(decision, "Work item") !== workItem) errors.push(`${relative(homeFile)} -> archived Decision Work item mismatch`);
                }
                if (specTarget && path.dirname(specTarget) !== annualRoot) {
                    errors.push(`${relative(homeFile)} -> ${terminalStatus} archive Product spec must be a direct annual archive record`);
                }
                if (specTarget) {
                    const spec = requireFields(specTarget, ["Document status", "Delivery status", "Updated", "Work item", "Decision", "Authority"]);
                    validateDocumentStatus(specTarget, spec, ["Archived"]);
                    if (field(spec, "Delivery status") !== terminalStatus) {
                        errors.push(`${relative(homeFile)} -> archived Product Spec Delivery status differs from package`);
                    }
                    if (field(spec, "Work item") !== workItem) errors.push(`${relative(homeFile)} -> archived Product Spec Work item mismatch`);
                    if (linkedFieldTarget(specTarget, spec, "Decision") !== decisionTarget) errors.push(`${relative(homeFile)} -> archived Product Spec Decision mismatch`);
                }
            }
        } else if (packageAuthority.kind === "governance") {
            const governanceTarget = packageAuthority.governanceTarget;
            let governance;
            if (terminalStatus === "Closed") {
                if (governanceTarget && path.dirname(governanceTarget) !== governanceRoot) {
                    errors.push(`${relative(homeFile)} -> Closed Governance contract must target docs/development/governance/`);
                }
                governance = governanceContracts.get(governanceTarget);
                if (!governance) errors.push(`${relative(homeFile)} -> Closed Governance contract is not a registered current GOV document`);
            } else {
                if (governanceTarget && path.dirname(governanceTarget) !== annualRoot) {
                    errors.push(`${relative(homeFile)} -> ${terminalStatus} Governance contract must be a direct annual archive record`);
                }
                governance = annualGovernanceRecords.get(governanceTarget);
                if (!governance) {
                    errors.push(`${relative(homeFile)} -> ${terminalStatus} Governance contract is not a registered annual Archived Governance record`);
                } else if (governance.deliveryStatus !== terminalStatus) {
                    errors.push(`${relative(homeFile)} -> archived Governance record Delivery status differs from package`);
                }
            }
            if (governance) {
                if (governance.workItem !== workItem) errors.push(`${relative(homeFile)} -> archived Governance contract Work item mismatch`);
                for (const id of governance.ids) {
                    if (!tracker.includes(id)) errors.push(`${relative(trackerFile)} -> missing Governance contract traceability ID ${id}`);
                    if (existsSync(sddFile) && !readFileSync(sddFile, "utf8").includes(id)) {
                        errors.push(`${relative(sddFile)} -> missing Governance contract traceability ID ${id}`);
                    }
                }
            }
        }
        const dispositionSection = closeout.split(/^## Information Disposition\s*$/mu)[1] ?? "";
        const allowedDispositions = new Set(["durable contract", "backlog", "archive", "delete-after-absorption"]);
        const dispositionArtifacts = packageFiles.filter((file) => file !== closeoutFile);
        const coveredPackageArtifacts = new Set();
        let completedDispositionRows = 0;
        for (const line of dispositionSection.split("\n")) {
            if (!line.trimStart().startsWith("|")) continue;
            const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
            if (cells.every((cell) => /^:?-{3,}:?$/u.test(cell)) || /^Source(?: artifact| information)?/iu.test(cells[0] ?? "")) continue;
            const disposition = cells[3] ?? "";
            if (!allowedDispositions.has(disposition)) {
                errors.push(`${relative(closeoutFile)} -> unknown Information Disposition ${disposition || "<empty>"}`);
                continue;
            }
            completedDispositionRows += 1;
            const complete = Boolean(cells[0] && cells[1] && cells[2] && cells[4]);
            if (!complete) errors.push(`${relative(closeoutFile)} -> incomplete Information Disposition row`);
            const localDestination = hasRepoLocalMarkdownLink(closeoutFile, cells[2] ?? "");
            if (!localDestination) errors.push(`${relative(closeoutFile)} -> disposition destination must be an existing repo-local Markdown file`);
            if (complete && localDestination) {
                const sourceReferences = new Set([
                    ...repoLocalMarkdownTargets(closeoutFile, cells[0]),
                    ...[...cells[0].matchAll(/(?:`|\()((?:docs\/|\.\.?\/)?[A-Za-z0-9_.\/-]+\.md)(?:`|\))/g)].map((match) => {
                        const reference = match[1];
                        return reference.startsWith("docs/")
                            ? path.join(repoRoot, reference)
                            : path.resolve(path.dirname(closeoutFile), reference);
                    }),
                    ...(/^\.?\/?[A-Za-z0-9_.-]+\.md$/u.test(cells[0])
                        ? [path.resolve(path.dirname(closeoutFile), cells[0])]
                        : []),
                ]);
                for (const artifact of dispositionArtifacts) {
                    if (sourceReferences.has(artifact)) coveredPackageArtifacts.add(artifact);
                }
            }
        }
        if (completedDispositionRows === 0) {
            errors.push(`${relative(closeoutFile)} -> Information Disposition has no completed disposition row`);
        }
        for (const artifact of dispositionArtifacts) {
            if (!coveredPackageArtifacts.has(artifact)) {
                errors.push(`${relative(closeoutFile)} -> Information Disposition omits package artifact ${path.basename(artifact)}`);
            }
        }
        closedWorkItems.add(workItem);
    }
}

const dispositionLog = readFileSync(index("archive/disposition-log.md"), "utf8");
const dispositionPaths = [];
for (const line of dispositionLog.split("\n")) {
    if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/u.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const pathEntries = [...(cells[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    let validRow = true;
    if (pathEntries.length === 0) errors.push("Disposition Log row is missing an original Markdown path");
    if (pathEntries.length === 0) validRow = false;
    if (!["absorbed", "deleted-after-absorption"].includes(cells[2])) {
        errors.push(`Disposition Log has invalid disposition: ${cells[2] ?? ""}`);
        validRow = false;
    }
    if (!hasRepoLocalMarkdownLink(index("archive/disposition-log.md"), cells[3] ?? "")) {
        errors.push(`Disposition Log ${pathEntries.join(", ")} destination must be an existing repo-local Markdown file`);
        validRow = false;
    }
    if (!cells[4]) {
        errors.push(`Disposition Log ${pathEntries.join(", ")} is missing a reason`);
        validRow = false;
    }
    if (validRow) dispositionPaths.push(...pathEntries);
}
const currentDocs = walkMarkdown(docsRoot);

function normalizedContinuityLines(content) {
    return content
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim()
            .replace(/\]\([^)]+\)/g, "]()")
            .replace(/^([-*]\s+)\[[ xX]\]\s+/u, "$1[ ] ")
            .replace(/^Updated:\s*\d{4}-\d{2}-\d{2}$/iu, "Updated:")
            .replace(/^Document status:\s*.+$/iu, "Document status:"))
        .filter(Boolean);
}

function contentContinuity(sourceContent, destinationContent) {
    const normalizedSource = sourceContent.replace(/\r\n?/g, "\n").trim();
    const normalizedDestination = destinationContent.replace(/\r\n?/g, "\n").trim();
    if (normalizedSource === normalizedDestination) return true;

    const sourceLines = normalizedContinuityLines(sourceContent);
    const destinationLines = normalizedContinuityLines(destinationContent);
    if (sourceLines.length < 8 || sourceLines.join("\n").length < 256 || destinationLines.length === 0) return false;

    const destinationCounts = new Map();
    for (const line of destinationLines) destinationCounts.set(line, (destinationCounts.get(line) ?? 0) + 1);
    let overlap = 0;
    for (const line of sourceLines) {
        const count = destinationCounts.get(line) ?? 0;
        if (count === 0) continue;
        overlap += 1;
        destinationCounts.set(line, count - 1);
    }
    const sourceCoverage = overlap / sourceLines.length;
    return sourceCoverage >= 0.9;
}

const continuityCandidates = currentDocs
    .filter((file) => reachableDocs.has(file) && !relative(file).startsWith("docs/development/templates/"))
    .map((file) => ({ file, content: readFileSync(file, "utf8") }));

const baseFileContentCache = new Map();
const basePathSetCache = new Map();
function baseFileContent(base, source) {
    const cacheKey = `${base}\0${source}`;
    if (baseFileContentCache.has(cacheKey)) return baseFileContentCache.get(cacheKey);
    try {
        const content = execFileSync("git", ["show", `${base}:${source}`], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
        baseFileContentCache.set(cacheKey, content);
        return content;
    } catch {
        baseFileContentCache.set(cacheKey, undefined);
        return undefined;
    }
}

function basePathSet(base) {
    if (basePathSetCache.has(base)) return basePathSetCache.get(base);
    const output = execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", base, "--", "docs"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe",
    });
    const paths = new Set(output.split("\0").filter(Boolean));
    basePathSetCache.set(base, paths);
    return paths;
}

function baseHasFile(base, source) {
    return basePathSet(base).has(source);
}

function hasContentContinuousMoveTarget(source, base, destination) {
    const sourceContent = baseFileContent(base, source);
    if (sourceContent === undefined) return false;
    if (destination) {
        const destinationFile = path.join(repoRoot, destination);
        return !baseHasFile(base, destination)
            && existsSync(destinationFile)
            && statSync(destinationFile).isFile()
            && contentContinuity(sourceContent, readFileSync(destinationFile, "utf8"));
    }
    return continuityCandidates.some((candidate) => {
        const candidatePath = relative(candidate.file);
        return candidatePath !== source
            && !baseHasFile(base, candidatePath)
            && contentContinuity(sourceContent, candidate.content);
    });
}

function hasDispositionFor(source) {
    return dispositionPaths.some((entry) => entry.endsWith("/**")
        ? source.startsWith(entry.slice(0, -2))
        : source === entry);
}
const explicitDiffBase = Boolean(process.env.DOCS_CHECK_BASE);
const diffBase = process.env.DOCS_CHECK_BASE || "HEAD";
try {
    execFileSync("git", ["rev-parse", "--verify", `${diffBase}^{commit}`], { cwd: repoRoot, stdio: "ignore" });
    let baseBacklogIds = new Set();
    try {
        const baseBacklog = execFileSync("git", ["show", `${diffBase}:docs/backlog.md`], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
        baseBacklogIds = new Set([...baseBacklog.matchAll(/^\|\s*((?:B|T)-\d{3})\s*\|/gmu)].map((match) => match[1]));
    } catch {
        // The baseline predates docs/backlog.md; there are no prior Backlog IDs to audit.
    }
    for (const removedId of [...baseBacklogIds].filter((id) => !backlogIdSet.has(id))) {
        if (!promotedWorkItems.has(removedId) && !closedWorkItems.has(removedId)) {
            errors.push(`Removed Backlog ${removedId} lacks an Active Package or terminal archive/closeout`);
        }
    }
    const diff = execFileSync("git", ["diff", "--name-status", "--find-renames", diffBase, "--", "docs"], { cwd: repoRoot, encoding: "utf8" });
    for (const line of diff.trim().split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        const status = parts[0];
        if (status.startsWith("R")) {
            const source = parts[1];
            const destination = parts[2];
            const sourceIsMarkdown = source?.endsWith(".md");
            const destinationIsMarkdown = destination?.endsWith(".md");
            if (!sourceIsMarkdown && !destinationIsMarkdown) continue;
            if (!sourceIsMarkdown || !destinationIsMarkdown) {
                errors.push(`Rename changes Markdown file type: ${source ?? ""} -> ${destination ?? ""}`);
                continue;
            }
            const activeSource = source?.match(/^docs\/development\/active\/([^/]+)\/([^/]+\.md)$/u);
            if (activeSource) {
                const [, feature, filename] = activeSource;
                const expectedDestination = new RegExp(`^docs/archive/\\d{4}/${escapeRegExp(feature)}/${escapeRegExp(filename)}$`, "u");
                if (!expectedDestination.test(destination ?? "")) {
                    errors.push(`Active Package rename must preserve feature/file path in annual Archive: ${source} -> ${destination ?? ""}`);
                }
            }
            const destinationFile = path.join(repoRoot, destination ?? "");
            if (!destination?.startsWith("docs/") || !existsSync(destinationFile) || !reachableDocs.has(destinationFile)) {
                errors.push(`Renamed Markdown destination is outside the indexed docs schema: ${destination ?? ""}`);
            }
            if (!hasContentContinuousMoveTarget(source, diffBase, destination) && !hasDispositionFor(source)) {
                errors.push(`Renamed Markdown lacks content continuity or disposition record: ${source} -> ${destination ?? ""}`);
            }
            continue;
        }
        if (status !== "D") continue;
        const deletedPath = parts[1];
        if (!deletedPath?.endsWith(".md")) continue;
        if (hasContentContinuousMoveTarget(deletedPath, diffBase)) continue;
        if (!hasDispositionFor(deletedPath)) {
            errors.push(`Deleted Markdown lacks content-continuous move target or disposition record: ${deletedPath}`);
        }
    }
} catch (error) {
    if (explicitDiffBase) errors.push(`DOCS_CHECK_BASE ${diffBase} is unavailable; deletion continuity cannot fail open`);
    else warnings.push(`Skipped deletion continuity check: git base ${diffBase} is unavailable (${error instanceof Error ? error.message : "unknown error"})`);
}

if (errors.length > 0) {
    console.error(`Documentation check failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log(`Documentation check passed: ${markdownFiles.length} Markdown files, ${checkedLinks} local links.`);
}
for (const warning of warnings) console.warn(`Warning: ${warning}`);

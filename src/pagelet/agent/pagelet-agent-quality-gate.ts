import {
    normalizeSnapshotPath,
    sameSourceSnapshot,
} from "./anchor-snapshot";
import { normalizePageletInsightBody } from "./pagelet-agent-cache";
import {
    isPageletNoInsightTerminal,
    type PageletAgentQualityGateResult,
    type PageletAgentRunResult,
    type PageletAgentSourceMaterial,
    type PageletAgentSourceSnapshot,
} from "./types";

const CONTENT_EVIDENCE_TOOLS = new Set([
    "get_current_note_context",
    "search_vault_snippets",
    "inspect_obsidian_note",
    "read_note_outline",
]);

const DEEP_FINDING_LANGUAGE = /(?:(?:根因|原因)\s*(?:是|为|在于)|矛盾|冲突|变化|演进|转变|缺口|遗漏|风险|因为|导致|意味着|因此|假设|行动|需要|应当|趋势|反例|contradict|conflict|changed?|evolv|shift|gap|missing|risk|because|caus|impl(?:y|ies)|therefore|assumption|should|action|trade[- ]?off|counterexample)/iu;

const NUMBERED_INSIGHT_HEADING = /^\s{0,3}#{1,6}[ \t]+(?:insight|洞察)[ \t]*([12])(?=[ \t]*(?:[:：.)、\-–—]|$))/iu;

const STOP_WORDS = new Set([
    "the", "and", "for", "from", "that", "this", "with", "into", "about",
    "note", "notes", "source", "path", "markdown", "both", "also", "same",
    "一个", "这个", "那个", "笔记", "来源", "路径", "相关", "相似", "提到",
]);

export interface PageletAgentQualityGateOptions {
    run: Pick<
        PageletAgentRunResult,
        "finalText" | "anchor" | "sourceSnapshots" | "sourceTools" | "toolProvenance"
    >;
    /** Evaluate an unchanged natural-Markdown staged candidate instead of terminal text. */
    body?: string;
    sourceMaterials: ReadonlyMap<string, PageletAgentSourceMaterial>;
    readCurrentSourceSnapshot(
        path: string,
        signal?: AbortSignal,
    ): Promise<PageletAgentSourceSnapshot | null>;
    isPathAllowed(path: string): boolean;
    anchorRelations?: {
        explicitLinks?: readonly string[];
        backlinks?: readonly string[];
    };
    isDuplicate?: (
        normalizedBody: string,
        sources: readonly PageletAgentSourceSnapshot[],
    ) => boolean;
    isSeen?: (
        body: string,
        normalizedBody: string,
        sources: readonly PageletAgentSourceSnapshot[],
    ) => boolean;
    signal?: AbortSignal;
}

export async function evaluatePageletAgentQuality(
    options: PageletAgentQualityGateOptions,
): Promise<PageletAgentQualityGateResult> {
    const body = (options.body ?? options.run.finalText).trim();
    if (!body) return reject("empty");
    if (isPageletNoInsightTerminal(body)) return reject("no-insight");
    if (hasBundledNumberedInsightHeadings(body)) return reject("bundled-insights");

    const anchorPath = options.run.anchor.path;
    if (!anchorWasRead(options.run, anchorPath)) return reject("anchor-not-read");

    const successfulSources = new Map(
        options.run.sourceSnapshots.map((source) => [source.path, source]),
    );
    if (
        successfulSources.size < 2
        || !successfulSources.has(anchorPath)
        || [...successfulSources.keys()].some((path) => !safeAllowed(options.isPathAllowed, path))
    ) {
        return reject("insufficient-vault-sources");
    }

    const references = resolveBodyReferences(body, [...successfulSources.keys()]);
    if (references.hasUngroundedPath) return reject("ungrounded-path");
    const citedPaths = references.citedPaths;
    if (
        citedPaths.size < 2
        || !citedPaths.has(anchorPath)
        || ![...citedPaths].some((path) => path !== anchorPath)
    ) {
        return reject("insufficient-vault-sources");
    }

    const verifiedSources: PageletAgentSourceSnapshot[] = [];
    for (const path of citedPaths) {
        const runSnapshot = successfulSources.get(path);
        const material = options.sourceMaterials.get(path);
        if (!runSnapshot || !material || !sameSourceSnapshot(runSnapshot, material)) {
            return reject("stale-source");
        }
        if (path !== anchorPath && !hasPageletContentEvidenceTool(options.run.sourceTools, path)) {
            return reject("unsupported-source");
        }
        if (!hasEvidenceOverlap(body, material.content, path)) {
            return reject("unsupported-source");
        }
        const current = await options.readCurrentSourceSnapshot(path, options.signal);
        if (!current || !sameSourceSnapshot(runSnapshot, current)) {
            return reject("stale-source");
        }
        verifiedSources.push({ ...runSnapshot });
    }
    verifiedSources.sort((left, right) => compareCodePoint(left.path, right.path));

    if (isOnlyShallowKnownLinks(
        body,
        options.run.anchor.content,
        anchorPath,
        verifiedSources,
        options.anchorRelations,
    )) {
        return reject("shallow-link");
    }

    const normalizedBody = normalizePageletInsightBody(body);
    if (options.isDuplicate?.(normalizedBody, verifiedSources)) return reject("duplicate");
    if (options.isSeen?.(body, normalizedBody, verifiedSources)) return reject("seen");

    return {
        accepted: true,
        body,
        normalizedBody,
        sources: verifiedSources,
        sourceRefs: verifiedSources.map((source) => ({ path: source.path })),
    };
}

export function resolvePageletInsightSourcePaths(
    body: string,
    successfulPaths: readonly string[],
): { paths: string[]; hasUngroundedPath: boolean } {
    const resolved = resolveBodyReferences(body, successfulPaths);
    return {
        paths: [...resolved.citedPaths].sort(compareCodePoint),
        hasUngroundedPath: resolved.hasUngroundedPath,
    };
}

export function arePageletAgentInsightsDistinct(
    first: Pick<Extract<PageletAgentQualityGateResult, { accepted: true }>, "normalizedBody" | "sources">,
    second: Pick<Extract<PageletAgentQualityGateResult, { accepted: true }>, "normalizedBody" | "sources">,
): boolean {
    if (first.normalizedBody === second.normalizedBody) return false;
    const firstClaim = normalizeClaimForComparison(first.normalizedBody);
    const secondClaim = normalizeClaimForComparison(second.normalizedBody);
    if (!firstClaim || !secondClaim || firstClaim === secondClaim) return false;

    const shorter = firstClaim.length <= secondClaim.length ? firstClaim : secondClaim;
    const longer = shorter === firstClaim ? secondClaim : firstClaim;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.58) return false;

    const similarity = jaccard(claimTerms(firstClaim), claimTerms(secondClaim));
    const sameEvidence = sourceIdentity(first.sources) === sourceIdentity(second.sources);
    return similarity < (sameEvidence ? 0.62 : 0.78);
}

function anchorWasRead(
    run: Pick<PageletAgentRunResult, "toolProvenance">,
    anchorPath: string,
): boolean {
    return run.toolProvenance.some((entry) => (
        !entry.isError
        && entry.toolName === "get_current_note_context"
        && entry.sourceRecords.some((record) => record.path === anchorPath)
    ));
}

export function hasPageletContentEvidenceTool(
    sourceTools: Pick<PageletAgentRunResult, "sourceTools">["sourceTools"],
    path: string,
): boolean {
    const tools = sourceTools.get(path);
    return Boolean(tools && [...tools].some((tool) => CONTENT_EVIDENCE_TOOLS.has(tool)));
}

/**
 * Fail closed only for the explicit protocol shape observed in production:
 * one draft containing both numbered Insight 1/2 headings. This deliberately
 * does not split Markdown or infer sections from ordinary headings/body text.
 */
function hasBundledNumberedInsightHeadings(body: string): boolean {
    const numbered = new Set<string>();
    for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
        const match = line.match(NUMBERED_INSIGHT_HEADING);
        if (match?.[1]) numbered.add(match[1]);
        if (numbered.has("1") && numbered.has("2")) return true;
    }
    return false;
}

function normalizeClaimForComparison(value: string): string {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/`[^`\n]*\.md`/giu, " ")
        .replace(/!?\[\[[^\]\n]+\]\]/gu, " ")
        .replace(/!?\[[^\]\n]*\]\([^\n)]+\)/gu, " ")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/[\p{P}\p{S}]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}

function claimTerms(value: string): Set<string> {
    const terms = new Set<string>();
    for (const match of value.matchAll(/[a-z0-9][a-z0-9_-]{2,}/g)) {
        if (!STOP_WORDS.has(match[0])) terms.add(match[0]);
    }
    for (const match of value.matchAll(/[\p{Script=Han}]{2,}/gu)) {
        const codePoints = Array.from(match[0]);
        for (let index = 0; index < codePoints.length - 1; index += 1) {
            terms.add(codePoints.slice(index, index + 2).join(""));
        }
    }
    return terms;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
    if (left.size === 0 || right.size === 0) return 0;
    let intersection = 0;
    for (const value of left) if (right.has(value)) intersection += 1;
    return intersection / (left.size + right.size - intersection);
}

function sourceIdentity(sources: readonly PageletAgentSourceSnapshot[]): string {
    return [...new Set(sources.map((source) => source.path))].sort(compareCodePoint).join("\u0000");
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function hasEvidenceOverlap(body: string, content: string, path: string): boolean {
    const basename = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    const scrubbedBody = replaceLiteral(
        replaceLiteral(
            replaceLiteral(body, path, " "),
            path.replace(/\.md$/i, ""),
            " ",
        ),
        basename,
        " ",
    );
    const bodyTerms = evidenceTerms(scrubbedBody);
    if (bodyTerms.size === 0) return false;
    const contentTerms = evidenceTerms(content);
    return [...bodyTerms].some((term) => contentTerms.has(term));
}

function replaceLiteral(value: string, search: string, replacement: string): string {
    return search ? value.split(search).join(replacement) : value;
}

function evidenceTerms(value: string): Set<string> {
    const normalized = value.normalize("NFKC").toLowerCase();
    const terms = new Set<string>();
    for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{2,}/g)) {
        if (!STOP_WORDS.has(match[0])) terms.add(match[0]);
    }
    for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
        const codePoints = Array.from(match[0]);
        for (let index = 0; index < codePoints.length - 1; index += 1) {
            const bigram = codePoints.slice(index, index + 2).join("");
            if (!STOP_WORDS.has(bigram)) terms.add(bigram);
        }
    }
    return terms;
}

function resolveBodyReferences(
    body: string,
    successfulPaths: readonly string[],
): { citedPaths: Set<string>; hasUngroundedPath: boolean } {
    const citedPaths = new Set<string>();
    const candidates = extractReferenceCandidates(body);

    let hasUngroundedPath = false;
    for (const candidate of candidates) {
        const rawTarget = unwrapReferenceTarget(candidate.target);
        if (isExternalReference(rawTarget)) continue;

        const exactTarget = normalizeSnapshotPath(rawTarget);
        const exactMatch = exactTarget
            ? matchSuccessfulPath(exactTarget, successfulPaths, false)
            : null;
        if (exactMatch) {
            citedPaths.add(exactMatch);
            continue;
        }

        const cleaned = cleanReferenceTarget(candidate.target);
        if (!cleaned) {
            if (!rawTarget || rawTarget.startsWith("#")) continue;
            hasUngroundedPath = true;
            continue;
        }
        if (isExternalReference(cleaned)) continue;
        const matched = matchSuccessfulPath(
            cleaned,
            successfulPaths,
            candidate.kind === "wikilink",
        );
        if (matched) {
            citedPaths.add(matched);
        } else {
            hasUngroundedPath = true;
        }
    }
    return { citedPaths, hasUngroundedPath };
}

interface ReferenceSpan {
    start: number;
    end: number;
}

interface ReferenceCandidate {
    target: string;
    kind: "inline-code" | "markdown-link" | "wikilink" | "emphasis" | "bare";
}

function extractReferenceCandidates(body: string): ReferenceCandidate[] {
    const candidates: ReferenceCandidate[] = [];
    const occupied: ReferenceSpan[] = [];
    const codeSpans: ReferenceSpan[] = [];

    // Code spans take precedence over their inner syntax. Any .md-shaped
    // mention inside a code span must still enter grounding; malformed
    // punctuation or prose around it may reject, but cannot bypass the gate.
    for (const match of body.matchAll(/`([^`\n]+)`/g)) {
        const start = match.index ?? 0;
        const span = { start, end: start + match[0].length };
        occupied.push(span);
        codeSpans.push(span);
        const target = match[1];
        if (target && /\.md\b/i.test(target)) {
            candidates.push({ target, kind: "inline-code" });
        }
    }
    collectExplicitReferences(
        body,
        /!?\[[^\]\n]*]\(([^)\n]+)\)/g,
        occupied,
        candidates,
        () => true,
        codeSpans,
        "markdown-link",
    );
    collectExplicitReferences(
        body,
        /!?\[\[([^\]\n]+)]]/g,
        occupied,
        candidates,
        () => true,
        codeSpans,
        "wikilink",
    );

    collectEmphasizedReferences(body, occupied, candidates);

    // Bare paths intentionally stay token-shaped. Paths containing spaces must
    // use an explicit wikilink, Markdown link, or exact backtick reference.
    for (const match of body.matchAll(/([^\s`"'“”‘’()[\]{}<>*~=]+\.md)(?=$|[^A-Za-z0-9_./-])/gimu)) {
        const target = match[1];
        const matchStart = match.index ?? 0;
        const span = {
            start: matchStart,
            end: matchStart + target.length,
        };
        if (!overlapsOccupiedSpan(span, occupied)) {
            candidates.push({ target, kind: "bare" });
        }
    }

    return candidates;
}

function collectExplicitReferences(
    body: string,
    pattern: RegExp,
    occupied: ReferenceSpan[],
    candidates: ReferenceCandidate[],
    isCandidate: (target: string) => boolean,
    blockedTargetSpans: readonly ReferenceSpan[] = [],
    kind: ReferenceCandidate["kind"] = "bare",
): void {
    for (const match of body.matchAll(pattern)) {
        const start = match.index ?? 0;
        const span = { start, end: start + match[0].length };
        occupied.push(span);
        const target = match[1];
        const targetOffset = target ? match[0].lastIndexOf(target) : -1;
        const targetSpan = targetOffset >= 0
            ? {
                start: start + targetOffset,
                end: start + targetOffset + target.length,
            }
            : span;
        if (overlapsOccupiedSpan(targetSpan, blockedTargetSpans)) continue;
        if (target && isCandidate(target)) candidates.push({ target, kind });
    }
}

function collectEmphasizedReferences(
    body: string,
    occupied: ReferenceSpan[],
    candidates: ReferenceCandidate[],
): void {
    for (const pattern of [/__([^\n]+?\.md)__/g, /_([^\n]+?\.md)_(?!_)/g]) {
        for (const match of body.matchAll(pattern)) {
            const start = match.index ?? 0;
            const span = { start, end: start + match[0].length };
            if (overlapsOccupiedSpan(span, occupied)) continue;
            occupied.push(span);
            const target = match[1];
            if (target) candidates.push({ target, kind: "emphasis" });
        }
    }
}

function overlapsOccupiedSpan(span: ReferenceSpan, occupied: readonly ReferenceSpan[]): boolean {
    return occupied.some((candidate) => span.start < candidate.end && candidate.start < span.end);
}

function cleanReferenceTarget(target: string): string | null {
    let value = unwrapReferenceTarget(target)
        .split("|", 1)[0]
        .split("#", 1)[0]
        .trim();
    if (!value) return null;
    try {
        value = decodeURIComponent(value);
    } catch {
        return null;
    }
    return normalizeSnapshotPath(value);
}

function unwrapReferenceTarget(target: string): string {
    const value = target.trim();
    return value.startsWith("<") && value.endsWith(">")
        ? value.slice(1, -1).trim()
        : value;
}

function matchSuccessfulPath(
    target: string,
    successfulPaths: readonly string[],
    allowBasenameFallback = true,
): string | null {
    const normalizedTarget = target.toLowerCase().endsWith(".md") ? target : `${target}.md`;
    const exact = successfulPaths.find((path) => path === normalizedTarget);
    if (exact) return exact;
    if (!allowBasenameFallback || normalizedTarget.includes("/")) return null;
    const targetBase = normalizedTarget.split("/").pop()?.toLowerCase();
    const basenameMatches = successfulPaths.filter((path) => (
        path.split("/").pop()?.toLowerCase() === targetBase
    ));
    return basenameMatches.length === 1 ? basenameMatches[0] : null;
}

function isExternalReference(value: string): boolean {
    return /^(?:https?|ftp):\/\//i.test(value)
        || /^mailto:/i.test(value)
        || value.startsWith("#");
}

function isOnlyShallowKnownLinks(
    body: string,
    anchorContent: string,
    anchorPath: string,
    sources: readonly PageletAgentSourceSnapshot[],
    relations: PageletAgentQualityGateOptions["anchorRelations"],
): boolean {
    const related = new Set([
        ...(relations?.explicitLinks ?? []),
        ...(relations?.backlinks ?? []),
    ].map((path) => normalizeSnapshotPath(path)).filter((path): path is string => Boolean(path)));
    for (const path of extractExplicitAnchorLinks(anchorContent, sources.map((source) => source.path))) {
        related.add(path);
    }
    const nonAnchor = sources.filter((source) => source.path !== anchorPath);
    if (nonAnchor.length === 0 || !nonAnchor.every((source) => related.has(source.path))) return false;
    return !DEEP_FINDING_LANGUAGE.test(body);
}

function extractExplicitAnchorLinks(
    anchorContent: string,
    successfulPaths: readonly string[],
): string[] {
    const paths = new Set<string>();
    const targets: ReferenceCandidate[] = [];
    for (const match of anchorContent.matchAll(/!?\[\[([^\]]+)]]/g)) {
        targets.push({ target: match[1], kind: "wikilink" });
    }
    for (const match of anchorContent.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
        targets.push({ target: match[1], kind: "markdown-link" });
    }
    for (const target of targets) {
        const cleaned = cleanReferenceTarget(target.target);
        if (!cleaned || isExternalReference(cleaned)) continue;
        const matched = matchSuccessfulPath(
            cleaned,
            successfulPaths,
            target.kind === "wikilink",
        );
        if (matched) paths.add(matched);
    }
    return [...paths];
}

function safeAllowed(predicate: (path: string) => boolean, path: string): boolean {
    try {
        return predicate(path) === true;
    } catch {
        return false;
    }
}

function reject(reason: Exclude<PageletAgentQualityGateResult, { accepted: true }>["reason"]):
    PageletAgentQualityGateResult {
    return { accepted: false, reason };
}

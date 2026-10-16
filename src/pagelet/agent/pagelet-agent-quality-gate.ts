import {
    normalizeSnapshotPath,
    sameSourceSnapshot,
} from "./anchor-snapshot";
import type { SourceRecord } from "../../ai-services/chat-types";
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
    "read_note",
]);

export function pageletObservationBodyEvidencePaths(
    toolName: string,
    promptText: string,
    sourceRecords: readonly SourceRecord[],
): string[] {
    const visiblePaths = new Set(sourceRecords
        .filter(record => record.path && !record.redacted && !record.statusOnly)
        .map(record => record.path as string));
    const evidencePaths = new Set<string>();
    const addPath = (path: unknown): void => {
        if (typeof path === "string" && visiblePaths.has(path)) evidencePaths.add(path);
    };
    try {
        const envelope = JSON.parse(promptText) as {
            status?: unknown;
            observation?: {
                path?: unknown;
                part?: unknown;
                text?: unknown;
                fullText?: unknown;
                headings?: unknown[];
                matches?: ReadonlyArray<{ path?: unknown; part?: unknown; snippet?: unknown }>;
            };
        };
        if (envelope.status !== "ok" || !envelope.observation) return [];
        const observation = envelope.observation;
        if (toolName === "get_current_note_context" || toolName === "inspect_obsidian_note") {
            if (typeof observation.fullText === "string" && observation.fullText.length > 0) {
                addPath(observation.path);
            }
        } else if (toolName === "read_note_outline") {
            if (Array.isArray(observation.headings) && observation.headings.length > 0) {
                addPath(observation.path);
            }
        } else if (toolName === "read_note") {
            if (
                observation.part === "body"
                && typeof observation.text === "string"
                && observation.text.length > 0
            ) {
                addPath(observation.path);
            }
        } else if (toolName === "search_vault_snippets") {
            for (const match of observation.matches ?? []) {
                if (
                    match
                    && match.part !== "properties"
                    && typeof match.snippet === "string"
                    && match.snippet.length > 0
                ) addPath(match.path);
            }
        }
        return [...evidencePaths];
    } catch {
        return [];
    }
}

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
    isPathAllowed(this: void, path: string): boolean;
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

export type PageletInsightSourceSupportFailure =
    | "stale-source"
    | "missing-content-tool";

interface PageletInsightSourceSupportOptions {
    body: string;
    anchorPath: string;
    citedPaths: ReadonlySet<string>;
    successfulSources: ReadonlyMap<string, PageletAgentSourceSnapshot>;
    sourceMaterials: ReadonlyMap<string, PageletAgentSourceMaterial>;
    sourceTools: Pick<PageletAgentRunResult, "sourceTools">["sourceTools"];
}

/**
 * Classify the deterministic source-support contract shared by the runtime
 * terminal gate and the controller's final quality gate. The result is
 * content-free so it can also be retained in runtime diagnostics.
 */
export function classifyPageletInsightSourceSupport(
    options: PageletInsightSourceSupportOptions,
): PageletInsightSourceSupportFailure | null {
    for (const path of options.citedPaths) {
        const runSnapshot = options.successfulSources.get(path);
        const material = options.sourceMaterials.get(path);
        if (!runSnapshot || !material || !sameSourceSnapshot(runSnapshot, material)) {
            return "stale-source";
        }
        if (!hasPageletContentEvidenceTool(options.sourceTools, path)) {
            return "missing-content-tool";
        }
    }

    return null;
}

export async function evaluatePageletAgentQuality(
    options: PageletAgentQualityGateOptions,
): Promise<PageletAgentQualityGateResult> {
    const body = options.body ?? options.run.finalText;
    if (!body.trim()) return reject("empty");
    if (isPageletNoInsightTerminal(body)) return reject("no-insight");

    const anchorPath = options.run.anchor.path;
    if (!anchorWasRead(options.run, anchorPath)) return reject("anchor-not-read");

    const successfulSources = new Map(
        options.run.sourceSnapshots.map((source) => [source.path, source]),
    );
    if (!successfulSources.has(anchorPath)) {
        return reject("insufficient-vault-sources");
    }

    const references = resolveBodyReferences(body, [...successfulSources.keys()]);
    if (references.hasUngroundedPath) return reject("ungrounded-path");
    const citedPaths = references.citedPaths;
    if (
        !citedPaths.has(anchorPath)
        || [...citedPaths].some((path) => !safeAllowed(options.isPathAllowed, path))
    ) {
        return reject("insufficient-vault-sources");
    }

    const sourceSupportFailure = classifyPageletInsightSourceSupport({
        body,
        anchorPath,
        citedPaths,
        successfulSources,
        sourceMaterials: options.sourceMaterials,
        sourceTools: options.run.sourceTools,
    });
    if (sourceSupportFailure === "stale-source") return reject("stale-source");
    if (sourceSupportFailure !== null) return reject("unsupported-source");

    const verifiedSources: PageletAgentSourceSnapshot[] = [];
    for (const path of citedPaths) {
        const runSnapshot = successfulSources.get(path);
        if (!runSnapshot) return reject("stale-source");
        const current = await options.readCurrentSourceSnapshot(path, options.signal);
        if (!current || !sameSourceSnapshot(runSnapshot, current)) {
            return reject("stale-source");
        }
        verifiedSources.push({ ...runSnapshot });
    }
    verifiedSources.sort((left, right) => compareCodePoint(left.path, right.path));

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

function anchorWasRead(
    run: Pick<PageletAgentRunResult, "sourceTools">,
    anchorPath: string,
): boolean {
    return hasPageletContentEvidenceTool(
        run.sourceTools,
        anchorPath,
    );
}

export function hasPageletContentEvidenceTool(
    sourceTools: Pick<PageletAgentRunResult, "sourceTools">["sourceTools"],
    path: string,
): boolean {
    const tools = sourceTools.get(path);
    return Boolean(tools && [...tools].some((tool) => CONTENT_EVIDENCE_TOOLS.has(tool)));
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function resolveBodyReferences(
    body: string,
    successfulPaths: readonly string[],
): {
    citedPaths: Set<string>;
    hasUngroundedPath: boolean;
} {
    const citedPaths = new Set<string>();
    const candidates = extractReferenceCandidates(body);

    let hasUngroundedPath = false;
    for (const candidate of candidates) {
        const rawTarget = unwrapReferenceTarget(candidate.target);
        if (isExternalReference(rawTarget)) continue;
        // A bare Obsidian fragment/alias has no delimiter that can distinguish
        // a spaced modifier from following prose. Treat it as ungrounded so
        // modifier text can never masquerade as source evidence; callers can
        // use an inline-code path, wikilink, or Markdown link instead.
        if (candidate.kind === "bare" && /[#|]/u.test(rawTarget)) {
            hasUngroundedPath = true;
            continue;
        }

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
    start: number;
    end: number;
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
            candidates.push({ target, kind: "inline-code", ...span });
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
        const baseTarget = match[1];
        const matchStart = match.index ?? 0;
        const modifierMarker = body[matchStart + baseTarget.length];
        const target = modifierMarker === "#" || modifierMarker === "|"
            ? `${baseTarget}${modifierMarker}`
            : baseTarget;
        const span = {
            start: matchStart,
            end: matchStart + target.length,
        };
        if (!overlapsOccupiedSpan(span, occupied)) {
            candidates.push({ target, kind: "bare", ...span });
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
        if (target && isCandidate(target)) candidates.push({ target, kind, ...span });
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
            if (target) candidates.push({ target, kind: "emphasis", ...span });
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

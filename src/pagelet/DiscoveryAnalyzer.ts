import type { DiscoveryResult, NoteConnection } from "./panel/types";
import type { StructuredFinding } from "./llm/types";

export type DiscoveryLLMCallback = (
    currentNote: { path: string; content: string },
    relatedNotes: Array<{ path: string; content: string }>,
) => Promise<DiscoveryResult | null>;

export type FindRelatedNotesCallback = (
    primarySourcePath: string,
    noteContents: Array<{ path: string; content: string }>,
    sourcePaths: readonly string[],
) => Promise<Array<{ path: string; content: string; score?: number; headingPath?: string[] }>>;

export function buildDiscoveryResultFromFindings(
    findings: readonly StructuredFinding[],
    currentNotePath: string,
    relatedNotes: ReadonlyArray<{ path: string }> = [],
): DiscoveryResult {
    const currentTerms = new Set(noteMatchTerms(currentNotePath));
    const connections: NoteConnection[] = findings
        .filter((f) => f.category === "connection")
        .map((f) => ({
            fromNote: currentNotePath,
            toNote: resolveConnectionTarget(f, currentNotePath, relatedNotes, currentTerms),
            strength: "medium" as const,
            sharedConcepts: [f.text],
        }));
    return {
        connections,
        themes: [],
        gaps: findings
            .filter((f) => f.category === "gap")
            .map((f) => ({ topic: f.sourceTitle || "", description: f.text })),
    };
}

function resolveConnectionTarget(
    finding: StructuredFinding,
    currentNotePath: string,
    relatedNotes: ReadonlyArray<{ path: string }>,
    currentTerms: ReadonlySet<string>,
): string {
    const normalizedCurrent = normalizePathLike(currentNotePath);
    const direct = finding.sourceFile.trim();
    if (direct && normalizePathLike(direct) !== normalizedCurrent) return direct;

    const haystack = [
        finding.sourceFile,
        finding.sourceTitle,
        finding.text,
    ].join("\n").toLowerCase();

    let bestScore = 0;
    let bestNote: { path: string } | undefined;
    for (const note of relatedNotes) {
        const score = scoreNoteMatch(note.path, haystack, currentTerms);
        if (score > bestScore) {
            bestScore = score;
            bestNote = note;
        }
    }
    return bestNote?.path ?? relatedNotes[0]?.path ?? direct;
}

function scoreNoteMatch(
    notePath: string,
    haystack: string,
    currentTerms: ReadonlySet<string>,
): number {
    const path = normalizePathLike(notePath).toLowerCase();
    if (path && haystack.includes(path)) return 100;

    const spacedTitle = titleFromPath(notePath).toLowerCase()
        .replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (spacedTitle && containsTerm(haystack, spacedTitle)) return 80;

    let score = 0;
    for (const term of noteMatchTerms(notePath)) {
        if (currentTerms.has(term)) continue;
        if (containsTerm(haystack, term)) {
            score += term.length;
        }
    }
    return score;
}

const HAS_CJK = /[一-鿿぀-ゟ゠-ヿ]/;

function containsTerm(text: string, term: string): boolean {
    if (HAS_CJK.test(term)) return text.includes(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(text);
}

function titleFromPath(path: string): string {
    const filename = path.split("/").pop() ?? path;
    return filename.replace(/\.md$/i, "").trim();
}

function normalizePathLike(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function noteMatchTerms(path: string): string[] {
    const filename = (path.split("/").pop() ?? path).replace(/\.md$/i, "").toLowerCase();
    const expanded = filename.replace(/\bzh\b/g, "chinese").replace(/\ben\b/g, "english");
    const terms = new Set<string>();
    for (const word of expanded.split(/[^a-z0-9]+/).filter(Boolean)) {
        if (word.length >= 3) terms.add(word);
    }
    const cjkRuns = filename.match(/[一-鿿぀-ゟ゠-ヿ]{2,}/g);
    if (cjkRuns) {
        for (const run of cjkRuns) terms.add(run);
    }
    return [...terms];
}

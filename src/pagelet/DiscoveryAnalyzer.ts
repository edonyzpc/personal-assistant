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
    const connections: NoteConnection[] = findings
        .filter((f) => f.category === "connection")
        .map((f) => ({
            fromNote: currentNotePath,
            toNote: resolveConnectionTarget(f, currentNotePath, relatedNotes),
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
): string {
    const normalizedCurrent = normalizePathLike(currentNotePath);
    const direct = finding.sourceFile.trim();
    if (direct && normalizePathLike(direct) !== normalizedCurrent) return direct;

    const haystack = [
        finding.sourceFile,
        finding.sourceTitle,
        finding.text,
    ].join("\n").toLowerCase();
    const matched = relatedNotes.find((note) => {
        const path = normalizePathLike(note.path).toLowerCase();
        const title = titleFromPath(note.path).toLowerCase();
        const aliases = noteAliases(note.path);
        return (title && haystack.includes(title))
            || (path && haystack.includes(path))
            || aliases.some((alias) => haystack.includes(alias));
    });
    return matched?.path ?? relatedNotes[0]?.path ?? direct;
}

function titleFromPath(path: string): string {
    const filename = path.split("/").pop() ?? path;
    return filename.replace(/\.md$/i, "").trim();
}

function normalizePathLike(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function titleAliases(title: string): string[] {
    const words = title
        .split(/[^a-z0-9]+/i)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
        .filter((word) => !["pagelet", "smoke", "note", "notes"].includes(word));
    const aliases = new Set<string>();
    if (words.length > 0) aliases.add(words.join(" "));
    for (const word of words) {
        if (["provider"].includes(word)) continue;
        if (word.length >= 4) aliases.add(word);
    }
    return [...aliases].filter((alias) => alias.length >= 4);
}

function noteAliases(path: string): string[] {
    const title = titleFromPath(path).toLowerCase();
    const filename = (path.split("/").pop() ?? path).replace(/\.md$/i, "").toLowerCase();
    const aliases = new Set<string>([
        ...titleAliases(title),
        ...titleAliases(filename.replace(/\bzh\b/g, "chinese").replace(/\ben\b/g, "english")),
    ]);
    return [...aliases];
}
